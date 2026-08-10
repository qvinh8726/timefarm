import { Temporal } from '@js-temporal/polyfill'
import { localeFor, translate } from '../i18n'
import type { AppLanguage, PauseInterval, WorkSession } from './types'

export interface ActiveInterval {
  start: number
  end: number
}

const toTime = (iso: string) => new Date(iso).getTime()

export function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function safeTimezone(timezone?: string): string {
  if (!timezone) return deviceTimezone()
  try {
    Temporal.Now.zonedDateTimeISO(timezone)
    return timezone
  } catch {
    return 'UTC'
  }
}

function instantFor(value: number | string | Date): Temporal.Instant {
  const epochMs = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : new Date(value).getTime()
  return Temporal.Instant.fromEpochMilliseconds(epochMs)
}

export function getSessionEnd(session: WorkSession, now = Date.now()): number {
  return session.endedAt ? toTime(session.endedAt) : now
}

export function activeIntervals(
  startAt: string,
  endAt: string | undefined,
  pauses: PauseInterval[],
  now = Date.now(),
): ActiveInterval[] {
  const start = toTime(startAt)
  const end = endAt ? toTime(endAt) : now
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return []

  const sortedPauses = pauses
    .map((pause) => ({
      start: Math.max(start, toTime(pause.startedAt)),
      end: Math.min(end, pause.endedAt ? toTime(pause.endedAt) : end),
    }))
    .filter((pause) => Number.isFinite(pause.start) && Number.isFinite(pause.end) && pause.end > pause.start)
    .sort((a, b) => a.start - b.start)

  const result: ActiveInterval[] = []
  let cursor = start
  for (const pause of sortedPauses) {
    if (pause.end <= cursor) continue
    if (pause.start > cursor) result.push({ start: cursor, end: pause.start })
    cursor = Math.max(cursor, pause.end)
  }
  if (cursor < end) result.push({ start: cursor, end })
  return result
}

export function activeDurationMs(session: WorkSession, now = Date.now()): number {
  if (session.status === 'completed' && session.activeDurationMs !== undefined) return session.activeDurationMs
  return activeIntervals(session.startedAt, session.endedAt, session.pauses, now)
    .reduce((total, interval) => total + interval.end - interval.start, 0)
}

export function formatDuration(durationMs: number, compact = false, language: AppLanguage = 'vi'): string {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (compact) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  if (hours === 0) return `${minutes} ${translate(language, 'duration', minutes === 1 ? 'minute' : 'minutes')}`
  return `${hours} ${translate(language, 'duration', hours === 1 ? 'hour' : 'hours')} ${minutes} ${translate(language, 'duration', minutes === 1 ? 'minute' : 'minutes')}`
}

export function formatClockTime(iso: string, language: AppLanguage, timezone?: string): string {
  return new Intl.DateTimeFormat(localeFor(language), {
    timeZone: safeTimezone(timezone),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

export function formatDate(iso: string, language: AppLanguage, timezone?: string): string {
  return new Intl.DateTimeFormat(localeFor(language), {
    timeZone: safeTimezone(timezone),
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso))
}

// `<input type="datetime-local">` deliberately has no zone. Convert an
// instant into the local wall-clock representation for the zone named in the
// accompanying UI, rather than slicing an ISO (UTC) string.
export function formatDateTimeLocalInput(iso: string, timezone = deviceTimezone()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimezone(timezone),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`
}

export function localDayKey(value: number | string | Date, timezone?: string): string {
  return instantFor(value).toZonedDateTimeISO(safeTimezone(timezone)).toPlainDate().toString()
}

export function isSameLocalDay(iso: string, reference = new Date(), timezone?: string): boolean {
  return localDayKey(iso, timezone) === localDayKey(reference, timezone)
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function startOfDayInTimezone(value: number | string | Date, timezone?: string): number {
  const zone = safeTimezone(timezone)
  const date = instantFor(value).toZonedDateTimeISO(zone).toPlainDate()
  return date.toZonedDateTime({ timeZone: zone, plainTime: Temporal.PlainTime.from('00:00') }).epochMilliseconds
}

export function addCalendarDays(value: number | string | Date, days: number, timezone?: string): number {
  const zone = safeTimezone(timezone)
  const date = instantFor(value).toZonedDateTimeISO(zone).toPlainDate().add({ days })
  return date.toZonedDateTime({ timeZone: zone, plainTime: Temporal.PlainTime.from('00:00') }).epochMilliseconds
}

export function splitIntervalsByLocalDay(intervals: ActiveInterval[], timezone?: string): Map<string, number> {
  const zone = safeTimezone(timezone)
  const daily = new Map<string, number>()
  for (const interval of intervals) {
    let cursor = interval.start
    while (cursor < interval.end) {
      const current = instantFor(cursor).toZonedDateTimeISO(zone)
      const nextMidnight = current.toPlainDate().add({ days: 1 }).toZonedDateTime({ timeZone: zone, plainTime: Temporal.PlainTime.from('00:00') }).epochMilliseconds
      const segmentEnd = Math.min(interval.end, nextMidnight)
      const key = current.toPlainDate().toString()
      daily.set(key, (daily.get(key) ?? 0) + segmentEnd - cursor)
      cursor = segmentEnd
    }
  }
  return daily
}
