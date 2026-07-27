import { describe, expect, it } from 'vitest'
import {
  buildDayOfWeekCron,
  computeNextOccurrence,
  formatCountdown,
  parseScheduleTime
} from '../shared/scheduleTime'

describe('parseScheduleTime', () => {
  it('parses a valid 24h HH:MM time', () => {
    expect(parseScheduleTime('05:30')).toEqual({ hour: 5, minute: 30 })
    expect(parseScheduleTime('23:59')).toEqual({ hour: 23, minute: 59 })
    expect(parseScheduleTime('00:00')).toEqual({ hour: 0, minute: 0 })
  })

  it('rejects malformed times', () => {
    expect(parseScheduleTime('24:00')).toBeNull()
    expect(parseScheduleTime('12:60')).toBeNull()
    expect(parseScheduleTime('5:30')).toBeNull()
    expect(parseScheduleTime('not a time')).toBeNull()
  })
})

describe('buildDayOfWeekCron', () => {
  it('builds a 5-field cron expression for the given time and days', () => {
    expect(buildDayOfWeekCron('05:30', [0, 1, 2, 3, 4, 5, 6])).toBe('30 5 * * 0,1,2,3,4,5,6')
  })

  it('sorts and dedupes days', () => {
    expect(buildDayOfWeekCron('05:30', [3, 1, 1, 0])).toBe('30 5 * * 0,1,3')
  })

  it('returns null when no days are selected', () => {
    expect(buildDayOfWeekCron('05:30', [])).toBeNull()
  })

  it('returns null for an invalid time', () => {
    expect(buildDayOfWeekCron('bad', [0])).toBeNull()
  })
})

describe('computeNextOccurrence', () => {
  it('returns later today if the time has not passed yet and today is selected', () => {
    // Wednesday 2026-07-29 10:00:00
    const now = new Date(2026, 6, 29, 10, 0, 0)
    const next = computeNextOccurrence(now, '15:30', [3])
    expect(next).toEqual(new Date(2026, 6, 29, 15, 30, 0))
  })

  it('rolls over to the next selected day if today\'s time already passed', () => {
    const now = new Date(2026, 6, 29, 20, 0, 0) // Wed 20:00
    const next = computeNextOccurrence(now, '15:30', [3]) // Wed only, already passed
    expect(next).toEqual(new Date(2026, 6, 29 + 7, 15, 30, 0))
  })

  it('picks the nearest of several selected days', () => {
    const now = new Date(2026, 6, 29, 20, 0, 0) // Wednesday
    const next = computeNextOccurrence(now, '10:00', [1, 5]) // Monday or Friday
    expect(next).toEqual(new Date(2026, 6, 31, 10, 0, 0)) // next Friday
  })

  it('returns null when no days are selected or the time is invalid', () => {
    expect(computeNextOccurrence(new Date(), '05:30', [])).toBeNull()
    expect(computeNextOccurrence(new Date(), 'nope', [0])).toBeNull()
  })
})

describe('formatCountdown', () => {
  it('formats a duration as DD:HH:MM:SS', () => {
    // 0 days, 4 hours, 27 minutes, 25 seconds
    const totalMs = ((4 * 60 + 27) * 60 + 25) * 1000
    expect(formatCountdown(totalMs)).toBe('00:04:27:25')
  })

  it('clamps negative durations to zero', () => {
    expect(formatCountdown(-5000)).toBe('00:00:00:00')
  })

  it('rolls over correctly across day boundaries', () => {
    const twoDays = 2 * 24 * 60 * 60 * 1000
    expect(formatCountdown(twoDays)).toBe('02:00:00:00')
  })
})
