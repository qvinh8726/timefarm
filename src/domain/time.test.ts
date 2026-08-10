import { describe, expect, it } from 'vitest'
import { activeDurationMs, activeIntervals, formatDateTimeLocalInput, formatDuration, localDayKey, splitIntervalsByLocalDay } from './time'
import type { WorkSession } from './types'

const base: WorkSession = {
  id: 'session-1',
  startedAt: '2026-08-09T08:00:00.000Z',
  endedAt: '2026-08-09T11:00:00.000Z',
  timezone: 'UTC',
  pauses: [],
  status: 'completed',
  createdAt: '2026-08-09T08:00:00.000Z',
  updatedAt: '2026-08-09T11:00:00.000Z',
  syncStatus: 'local',
}

describe('timer duration', () => {
  it('excludes completed and in-progress pause intervals', () => {
    const session: WorkSession = {
      ...base,
      pauses: [
        { startedAt: '2026-08-09T08:30:00.000Z', endedAt: '2026-08-09T09:00:00.000Z' },
        { startedAt: '2026-08-09T10:00:00.000Z' },
      ],
    }
    expect(activeDurationMs(session, new Date('2026-08-09T10:30:00.000Z').getTime())).toBe(90 * 60_000)
  })

  it('creates non-overlapping active intervals', () => {
    const intervals = activeIntervals(base.startedAt, base.endedAt, [
      { startedAt: '2026-08-09T08:15:00.000Z', endedAt: '2026-08-09T08:30:00.000Z' },
      { startedAt: '2026-08-09T08:20:00.000Z', endedAt: '2026-08-09T08:45:00.000Z' },
    ])
    expect(intervals).toEqual([
      { start: new Date('2026-08-09T08:00:00.000Z').getTime(), end: new Date('2026-08-09T08:15:00.000Z').getTime() },
      { start: new Date('2026-08-09T08:45:00.000Z').getTime(), end: new Date('2026-08-09T11:00:00.000Z').getTime() },
    ])
  })

  it('allocates active time through midnight', () => {
    const split = splitIntervalsByLocalDay([{ start: new Date(2026, 7, 9, 23, 30).getTime(), end: new Date(2026, 7, 10, 1, 0).getTime() }])
    expect([...split.values()]).toEqual([30 * 60_000, 60 * 60_000])
  })

  it('uses the stored IANA timezone instead of the current device timezone', () => {
    const instant = '2026-08-10T00:30:00.000Z'
    expect(localDayKey(instant, 'Asia/Saigon')).toBe('2026-08-10')
    expect(localDayKey(instant, 'America/New_York')).toBe('2026-08-09')
  })

  it('keeps actual elapsed time correct when a local day crosses DST', () => {
    const fallBack = splitIntervalsByLocalDay([{
      start: new Date('2026-11-01T03:30:00.000Z').getTime(),
      end: new Date('2026-11-01T06:30:00.000Z').getTime(),
    }], 'America/New_York')
    expect([...fallBack.entries()]).toEqual([
      ['2026-10-31', 30 * 60_000],
      ['2026-11-01', 150 * 60_000],
    ])

    const springForward = splitIntervalsByLocalDay([{
      start: new Date('2026-03-08T04:30:00.000Z').getTime(),
      end: new Date('2026-03-08T08:30:00.000Z').getTime(),
    }], 'America/New_York')
    expect([...springForward.entries()]).toEqual([
      ['2026-03-07', 30 * 60_000],
      ['2026-03-08', 210 * 60_000],
    ])
  })

  it('formats a recovery datetime-local minimum in the zone shown to the user', () => {
    expect(formatDateTimeLocalInput('2026-08-10T00:30:00.000Z', 'America/New_York')).toBe('2026-08-09T20:30')
    expect(formatDateTimeLocalInput('2026-08-10T00:30:00.000Z', 'Asia/Saigon')).toBe('2026-08-10T07:30')
  })

  it('formats non-compact durations in the selected application language', () => {
    expect(formatDuration(61_000, false, 'vi')).toBe('1 phút')
    expect(formatDuration(3_661_000, false, 'en')).toBe('1 hour 1 minute')
  })
})
