import { Temporal } from '@js-temporal/polyfill'
import { localeFor } from '../i18n'
import { sumMoney } from './money'
import { activeDurationMs, activeIntervals, deviceTimezone, splitIntervalsByLocalDay } from './time'
import type { AppLanguage, CurrencyCode, Goal, GoalKind, Project, WorkSession } from './types'

export interface DailyPoint {
  key: string
  label: string
  activeMs: number
  // Only time from sessions whose original earnings use the selected
  // currency. It is the denominator for an original-currency hourly rate.
  earningActiveMs: number
  earningsMinor: number
}

export interface ProjectBreakdown {
  projectId?: string
  name: string
  color: string
  activeMs: number
  earningActiveMs: number
  earningsMinor: number
}

export interface AnalyticsRange {
  startMs: number
  endMs: number
  timezone: string
}

export type AnalyticsRangePreset = '7d' | '30d' | '1m' | '3m' | '6m' | '1y'

export interface RangeSummary {
  activeMs: number
  earningActiveMs: number
  earningsMinor: number
  sessionCount: number
  averageActiveMsPerDay: number
  averageEarningsMinorPerDay: number
  effectiveHourlyMinor: number | null
}

export interface PeriodComparison {
  current: RangeSummary
  previous: RangeSummary
  activeMsChange: number | null
  earningsChange: number | null
}

export interface DurationBucket {
  id: string
  label: string
  count: number
}

export interface EfficiencyRanking extends ProjectBreakdown {
  effectiveHourlyMinor: number | null
}

export interface GoalProgress {
  current: number
  target: number
  remaining: number
  percentage: number
  expectedCurrent: number | null
  status: 'complete' | 'ahead' | 'behind' | 'on_track' | 'insufficient_data'
  pacePerHour: number | null
  projectedCompletionAt?: string
}

const DAY_MS = 86_400_000

function safeTimezone(timezone?: string): string {
  if (!timezone) return deviceTimezone()
  try {
    Temporal.Now.zonedDateTimeISO(timezone)
    return timezone
  } catch {
    return 'UTC'
  }
}

function instant(ms: number): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(ms)
}

function dayStart(date: Temporal.PlainDate, timezone: string): number {
  return date.toZonedDateTime({ timeZone: timezone, plainTime: Temporal.PlainTime.from('00:00') }).epochMilliseconds
}

function dayLabel(key: string, timezone: string, language: AppLanguage): string {
  const date = Temporal.PlainDate.from(key)
  const epoch = dayStart(date, timezone)
  return new Intl.DateTimeFormat(localeFor(language), { weekday: 'short', day: 'numeric', timeZone: timezone }).format(new Date(epoch))
}

function rangeDayCount(range: AnalyticsRange): number {
  const first = instant(range.startMs).toZonedDateTimeISO(range.timezone).toPlainDate()
  const last = instant(Math.max(range.startMs, range.endMs - 1)).toZonedDateTimeISO(range.timezone).toPlainDate()
  return Math.max(1, first.until(last, { largestUnit: 'days' }).days + 1)
}

export function completedSessions(sessions: WorkSession[]): WorkSession[] {
  return sessions.filter((session) => session.status === 'completed')
}

export function resolveRange(preset: AnalyticsRangePreset, timezone = deviceTimezone(), nowMs = Date.now()): AnalyticsRange {
  const zone = safeTimezone(timezone)
  const current = instant(nowMs).toZonedDateTimeISO(zone)
  const today = current.toPlainDate()
  if (preset === '7d' || preset === '30d') {
    const days = preset === '7d' ? 7 : 30
    return { startMs: dayStart(today.subtract({ days: days - 1 }), zone), endMs: nowMs, timezone: zone }
  }
  const monthCount = preset === '1m' ? 1 : preset === '3m' ? 3 : preset === '6m' ? 6 : 12
  const startMonth = Temporal.PlainDate.from({ year: today.year, month: today.month, day: 1 }).subtract({ months: monthCount - 1 })
  return { startMs: dayStart(startMonth, zone), endMs: nowMs, timezone: zone }
}

export function currentDayRange(timezone = deviceTimezone(), nowMs = Date.now()): AnalyticsRange {
  const zone = safeTimezone(timezone)
  const today = instant(nowMs).toZonedDateTimeISO(zone).toPlainDate()
  return { startMs: dayStart(today, zone), endMs: nowMs, timezone: zone }
}

export function previousEquivalentRange(range: AnalyticsRange): AnalyticsRange {
  const duration = Math.max(1, range.endMs - range.startMs)
  return { startMs: range.startMs - duration, endMs: range.startMs, timezone: range.timezone }
}

export function sessionsSince(sessions: WorkSession[], days: number, now = new Date(), timezone = deviceTimezone()): WorkSession[] {
  const range: AnalyticsRange = {
    startMs: dayStart(instant(now.getTime()).toZonedDateTimeISO(safeTimezone(timezone)).toPlainDate().subtract({ days: days - 1 }), safeTimezone(timezone)),
    endMs: now.getTime(),
    timezone: safeTimezone(timezone),
  }
  return completedSessions(sessions).filter((session) => sessionContribution(session, range).activeMs > 0)
}

export function totalActiveMs(sessions: WorkSession[], now = Date.now()): number {
  return sessions.reduce((total, session) => total + activeDurationMs(session, now), 0)
}

export function totalEarningsMinor(sessions: WorkSession[], currency: CurrencyCode): number {
  return sumMoney(sessions.map((session) => session.earnings), currency).amountMinor
}

export function effectiveHourlyMinor(sessions: WorkSession[], currency: CurrencyCode): number | null {
  const duration = sessions
    .filter((session) => session.earnings?.currency === currency)
    .reduce((total, session) => total + activeDurationMs(session), 0)
  if (duration < 60_000) return null
  return Math.round(totalEarningsMinor(sessions, currency) / (duration / 3_600_000))
}

export function clipIntervalsToRange(intervals: { start: number; end: number }[], range: AnalyticsRange): { start: number; end: number }[] {
  return intervals
    .map((interval) => ({ start: Math.max(interval.start, range.startMs), end: Math.min(interval.end, range.endMs) }))
    .filter((interval) => interval.end > interval.start)
}

export function sessionContribution(session: WorkSession, range: AnalyticsRange, currency?: CurrencyCode): { activeMs: number; earningActiveMs: number; earningsMinor: number } {
  const allIntervals = activeIntervals(session.startedAt, session.endedAt, session.pauses)
  const totalMs = allIntervals.reduce((total, interval) => total + interval.end - interval.start, 0)
  const activeMs = clipIntervalsToRange(allIntervals, range).reduce((total, interval) => total + interval.end - interval.start, 0)
  const matchingEarnings = session.earnings && (!currency || session.earnings.currency === currency) ? session.earnings : undefined
  const earningActiveMs = matchingEarnings ? activeMs : 0
  const earningsMinor = matchingEarnings && totalMs > 0
    ? Math.round(matchingEarnings.amountMinor * (activeMs / totalMs))
    : 0
  return { activeMs, earningActiveMs, earningsMinor }
}

export function rangeSummary(sessions: WorkSession[], currency: CurrencyCode, range: AnalyticsRange): RangeSummary {
  let activeMs = 0
  let earningActiveMs = 0
  let earningsMinor = 0
  let sessionCount = 0
  for (const session of completedSessions(sessions)) {
    const contribution = sessionContribution(session, range, currency)
    if (contribution.activeMs === 0) continue
    activeMs += contribution.activeMs
    earningActiveMs += contribution.earningActiveMs
    earningsMinor += contribution.earningsMinor
    sessionCount += 1
  }
  const days = rangeDayCount(range)
  return {
    activeMs,
    earningActiveMs,
    earningsMinor,
    sessionCount,
    averageActiveMsPerDay: activeMs / days,
    averageEarningsMinorPerDay: earningsMinor / days,
    effectiveHourlyMinor: earningActiveMs < 60_000 ? null : Math.round(earningsMinor / (earningActiveMs / 3_600_000)),
  }
}

export function dailySeries(sessions: WorkSession[], days: number, currency: CurrencyCode, now = new Date(), timezone = deviceTimezone(), language: AppLanguage = 'en'): DailyPoint[] {
  const zone = safeTimezone(timezone)
  const range: AnalyticsRange = {
    startMs: dayStart(instant(now.getTime()).toZonedDateTimeISO(zone).toPlainDate().subtract({ days: days - 1 }), zone),
    endMs: now.getTime(),
    timezone: zone,
  }
  return rangeDailySeries(sessions, currency, range, language)
}

export function rangeDailySeries(sessions: WorkSession[], currency: CurrencyCode, range: AnalyticsRange, language: AppLanguage = 'en'): DailyPoint[] {
  const points = new Map<string, DailyPoint>()
  const zone = safeTimezone(range.timezone)
  const startDate = instant(range.startMs).toZonedDateTimeISO(zone).toPlainDate()
  const endDate = instant(Math.max(range.startMs, range.endMs - 1)).toZonedDateTimeISO(zone).toPlainDate()
  for (let date = startDate; Temporal.PlainDate.compare(date, endDate) <= 0; date = date.add({ days: 1 })) {
    const key = date.toString()
    points.set(key, { key, label: dayLabel(key, zone, language), activeMs: 0, earningActiveMs: 0, earningsMinor: 0 })
  }

  for (const session of completedSessions(sessions)) {
    const allIntervals = activeIntervals(session.startedAt, session.endedAt, session.pauses)
    const totalMs = allIntervals.reduce((total, interval) => total + interval.end - interval.start, 0)
    if (totalMs === 0) continue
    const byDay = splitIntervalsByLocalDay(clipIntervalsToRange(allIntervals, range), zone)
    for (const [key, activeMs] of byDay.entries()) {
      const point = points.get(key)
      if (!point) continue
      point.activeMs += activeMs
      if (session.earnings?.currency === currency) {
        point.earningActiveMs += activeMs
        point.earningsMinor += Math.round(session.earnings.amountMinor * (activeMs / totalMs))
      }
    }
  }
  return [...points.values()]
}

export function cumulativeSeries(points: DailyPoint[]): DailyPoint[] {
  let activeMs = 0
  let earningActiveMs = 0
  let earningsMinor = 0
  return points.map((point) => {
    activeMs += point.activeMs
    earningActiveMs += point.earningActiveMs
    earningsMinor += point.earningsMinor
    return { ...point, activeMs, earningActiveMs, earningsMinor }
  })
}

export function projectBreakdown(sessions: WorkSession[], projects: Project[], currency: CurrencyCode, range?: AnalyticsRange): ProjectBreakdown[] {
  const byProject = new Map<string, ProjectBreakdown>()
  const projectMap = new Map(projects.map((project) => [project.id, project]))
  for (const session of completedSessions(sessions)) {
    const project = session.projectId ? projectMap.get(session.projectId) : undefined
    const key = project?.id ?? 'unassigned'
    const existing = byProject.get(key) ?? {
      projectId: project?.id,
      name: project?.name ?? 'Không gắn dự án',
      color: project?.color ?? '#94a3b8',
      activeMs: 0,
      earningActiveMs: 0,
      earningsMinor: 0,
    }
    const contribution = range
      ? sessionContribution(session, range, currency)
      : {
        activeMs: activeDurationMs(session),
        earningActiveMs: session.earnings?.currency === currency ? activeDurationMs(session) : 0,
        earningsMinor: session.earnings?.currency === currency ? session.earnings.amountMinor : 0,
      }
    if (contribution.activeMs === 0) continue
    existing.activeMs += contribution.activeMs
    existing.earningActiveMs += contribution.earningActiveMs
    existing.earningsMinor += contribution.earningsMinor
    byProject.set(key, existing)
  }
  return [...byProject.values()].sort((a, b) => b.activeMs - a.activeMs)
}

export function periodComparison(sessions: WorkSession[], currency: CurrencyCode, range: AnalyticsRange): PeriodComparison {
  const current = rangeSummary(sessions, currency, range)
  const previous = rangeSummary(sessions, currency, previousEquivalentRange(range))
  const percentChange = (currentValue: number, previousValue: number): number | null => previousValue === 0 ? null : ((currentValue - previousValue) / previousValue) * 100
  return { current, previous, activeMsChange: percentChange(current.activeMs, previous.activeMs), earningsChange: percentChange(current.earningsMinor, previous.earningsMinor) }
}

export function durationDistribution(sessions: WorkSession[], range?: AnalyticsRange): DurationBucket[] {
  const buckets: DurationBucket[] = [
    { id: 'under_30m', label: '< 30m', count: 0 },
    { id: '30m_to_1h', label: '30m–1h', count: 0 },
    { id: '1h_to_2h', label: '1–2h', count: 0 },
    { id: '2h_to_4h', label: '2–4h', count: 0 },
    { id: 'over_4h', label: '4h+', count: 0 },
  ]
  for (const session of completedSessions(sessions)) {
    const duration = range ? sessionContribution(session, range).activeMs : activeDurationMs(session)
    if (duration === 0) continue
    const index = duration < 30 * 60_000 ? 0 : duration < 60 * 60_000 ? 1 : duration < 2 * 3_600_000 ? 2 : duration < 4 * 3_600_000 ? 3 : 4
    buckets[index].count += 1
  }
  return buckets
}

export function projectEfficiencyRanking(sessions: WorkSession[], projects: Project[], currency: CurrencyCode, range?: AnalyticsRange): EfficiencyRanking[] {
  return projectBreakdown(sessions, projects, currency, range)
    .map((entry) => ({ ...entry, effectiveHourlyMinor: entry.earningActiveMs < 60_000 ? null : Math.round(entry.earningsMinor / (entry.earningActiveMs / 3_600_000)) }))
    .sort((a, b) => (b.effectiveHourlyMinor ?? -1) - (a.effectiveHourlyMinor ?? -1))
}

function goalRange(kind: GoalKind, timezone: string, nowMs: number): AnalyticsRange {
  const zone = safeTimezone(timezone)
  const now = instant(nowMs).toZonedDateTimeISO(zone)
  const date = now.toPlainDate()
  if (kind.endsWith('daily')) return { startMs: dayStart(date, zone), endMs: nowMs, timezone: zone }
  if (kind.endsWith('weekly')) {
    const weekday = date.dayOfWeek
    return { startMs: dayStart(date.subtract({ days: weekday - 1 }), zone), endMs: nowMs, timezone: zone }
  }
  return { startMs: dayStart(Temporal.PlainDate.from({ year: date.year, month: date.month, day: 1 }), zone), endMs: nowMs, timezone: zone }
}

export function goalCurrentValue(goal: Goal, sessions: WorkSession[], projects: Project[], currency: CurrencyCode, now = new Date(), timezone = deviceTimezone()): number {
  if (goal.kind === 'projects_completed') {
    // Project completion has no custom deadline field in the current model,
    // so it deliberately follows the same current-month cadence as the
    // monthly earnings goal. Do not count undated or future completions.
    const range = goalRange(goal.kind, timezone, now.getTime())
    return projects.filter((project) => {
      if (project.status !== 'completed' || !project.completedAt) return false
      const completedMs = Date.parse(project.completedAt)
      return Number.isFinite(completedMs) && completedMs >= range.startMs && completedMs <= range.endMs
    }).length
  }
  const summary = rangeSummary(sessions, currency, goalRange(goal.kind, timezone, now.getTime()))
  return goal.kind.startsWith('hours') ? summary.activeMs / 3_600_000 : summary.earningsMinor
}

export function calculateGoalProgress(goal: Goal, sessions: WorkSession[], projects: Project[], currency: CurrencyCode, now = new Date(), timezone = deviceTimezone()): GoalProgress {
  const current = goalCurrentValue(goal, sessions, projects, currency, now, timezone)
  const percentage = Math.min(100, (current / goal.target) * 100)
  const remaining = Math.max(0, goal.target - current)
  const range = goalRange(goal.kind, timezone, now.getTime())
  const zone = safeTimezone(timezone)
  const startDate = instant(range.startMs).toZonedDateTimeISO(zone).toPlainDate()
  const endExclusive = goal.kind.endsWith('daily')
    ? dayStart(startDate.add({ days: 1 }), zone)
    : goal.kind.endsWith('weekly')
      ? dayStart(startDate.add({ days: 7 }), zone)
      : dayStart(startDate.add({ months: 1 }), zone)
  const elapsedMs = Math.max(0, now.getTime() - range.startMs)
  const spanMs = Math.max(1, endExclusive - range.startMs)
  const expectedCurrent = goal.target * Math.min(1, elapsedMs / spanMs)
  const pacePerHour = elapsedMs < 60_000 || current === 0 ? null : current / (elapsedMs / 3_600_000)
  const projectedCompletionAt = pacePerHour && remaining > 0 ? new Date(now.getTime() + (remaining / pacePerHour) * 3_600_000).toISOString() : undefined
  const status: GoalProgress['status'] = current >= goal.target ? 'complete' : current >= expectedCurrent * 1.05 ? 'ahead' : current >= expectedCurrent * 0.95 ? 'on_track' : 'behind'
  return { current, target: goal.target, remaining, percentage, expectedCurrent, status, pacePerHour, projectedCompletionAt }
}

export function goalUnit(kind: GoalKind): 'hours' | 'moneyMinor' | 'count' {
  if (kind.startsWith('hours')) return 'hours'
  if (kind.startsWith('earnings')) return 'moneyMinor'
  return 'count'
}

export const analyticsConstants = { DAY_MS }
