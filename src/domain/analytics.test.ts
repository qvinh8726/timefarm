import { describe, expect, it } from 'vitest'
import { calculateGoalProgress, dailySeries, effectiveHourlyMinor, goalCurrentValue, rangeDailySeries, rangeSummary, resolveRange, sessionContribution, totalEarningsMinor } from './analytics'
import type { Goal, Project, WorkSession } from './types'

const sessions: WorkSession[] = [{
  id: 's1', projectId: 'p1', startedAt: '2026-08-09T08:00:00.000Z', endedAt: '2026-08-09T10:00:00.000Z',
  timezone: 'UTC', pauses: [], activeDurationMs: 7_200_000, status: 'completed',
  earnings: { amountMinor: 7_500, currency: 'USD' }, createdAt: '2026-08-09T08:00:00.000Z', updatedAt: '2026-08-09T10:00:00.000Z', syncStatus: 'local',
}]

describe('earnings analytics', () => {
  it('uses original matching-currency amounts and derives an hourly rate', () => {
    expect(totalEarningsMinor(sessions, 'USD')).toBe(7_500)
    expect(effectiveHourlyMinor(sessions, 'USD')).toBe(3_750)
    expect(totalEarningsMinor(sessions, 'VND')).toBe(0)
  })

  it('clips a cross-boundary session and allocates original earnings proportionally', () => {
    const session: WorkSession = {
      ...sessions[0], id: 'cross-boundary', startedAt: '2026-08-01T00:00:00.000Z', endedAt: '2026-08-01T04:00:00.000Z', activeDurationMs: 14_400_000,
      earnings: { amountMinor: 10_000, currency: 'USD' },
    }
    const range = { startMs: new Date('2026-08-01T02:00:00.000Z').getTime(), endMs: new Date('2026-08-01T03:00:00.000Z').getTime(), timezone: 'UTC' }
    expect(sessionContribution(session, range, 'USD')).toEqual({ activeMs: 3_600_000, earningActiveMs: 3_600_000, earningsMinor: 2_500 })
  })

  it('creates every requested day rather than capping long ranges to 30 days', () => {
    const now = new Date('2026-08-10T12:00:00.000Z')
    const points = dailySeries([], 90, 'USD', now, 'UTC')
    expect(points).toHaveLength(90)
    expect(points[0].key).toBe('2026-05-13')
    expect(points.at(-1)?.key).toBe('2026-08-10')
    const yearRange = resolveRange('1y', 'UTC', now.getTime())
    expect(rangeDailySeries([], 'USD', yearRange)).toHaveLength(344)
  })

  it('formats daily chart labels with the selected application locale', () => {
    const range = { startMs: new Date('2026-08-10T00:00:00.000Z').getTime(), endMs: new Date('2026-08-11T00:00:00.000Z').getTime(), timezone: 'UTC' }
    const instant = new Date('2026-08-10T00:00:00.000Z')
    const options = { weekday: 'short' as const, day: 'numeric' as const, timeZone: 'UTC' }
    expect(rangeDailySeries([], 'USD', range, 'vi')[0]?.label).toBe(new Intl.DateTimeFormat('vi-VN', options).format(instant))
    expect(rangeDailySeries([], 'USD', range, 'en')[0]?.label).toBe(new Intl.DateTimeFormat('en-US', options).format(instant))
  })

  it('never lets foreign-currency work time dilute an original-currency hourly rate', () => {
    const foreign: WorkSession = {
      ...sessions[0], id: 'foreign', startedAt: '2026-08-09T10:00:00.000Z', endedAt: '2026-08-09T12:00:00.000Z',
      earnings: { amountMinor: 20_000, currency: 'USD' }, activeDurationMs: 7_200_000,
    }
    const range = { startMs: new Date('2026-08-09T08:00:00.000Z').getTime(), endMs: new Date('2026-08-09T12:00:00.000Z').getTime(), timezone: 'UTC' }
    const summary = rangeSummary([{ ...sessions[0], earnings: { amountMinor: 1_000_000, currency: 'VND' } }, foreign], 'VND', range)
    expect(summary.activeMs).toBe(14_400_000)
    expect(summary.earningActiveMs).toBe(7_200_000)
    expect(summary.effectiveHourlyMinor).toBe(500_000)
  })

  it('uses a visible current-month cadence and pace for completed-project goals', () => {
    const now = new Date('2026-08-10T12:00:00.000Z')
    const goal: Goal = { id: 'goal-projects', kind: 'projects_completed', target: 4, createdAt: '2026-08-01T00:00:00.000Z', syncStatus: 'local' }
    const projects: Project[] = [
      { id: 'in-range', name: 'In range', paymentModel: 'per_session', color: '#7c3aed', icon: '*', status: 'completed', completedAt: '2026-08-04T12:00:00.000Z', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-04T12:00:00.000Z', syncStatus: 'local' },
      { id: 'old', name: 'Old', paymentModel: 'per_session', color: '#7c3aed', icon: '*', status: 'completed', completedAt: '2026-07-31T23:59:59.000Z', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-31T23:59:59.000Z', syncStatus: 'local' },
      { id: 'future', name: 'Future', paymentModel: 'per_session', color: '#7c3aed', icon: '*', status: 'completed', completedAt: '2026-08-11T00:00:00.000Z', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z', syncStatus: 'local' },
    ]
    expect(goalCurrentValue(goal, [], projects, 'USD', now, 'UTC')).toBe(1)
    const progress = calculateGoalProgress(goal, [], projects, 'USD', now, 'UTC')
    expect(progress.expectedCurrent).not.toBeNull()
    expect(progress.pacePerHour).not.toBeNull()
    expect(progress.status).toBe('behind')
    expect(progress.projectedCompletionAt).toBeDefined()
  })
})
