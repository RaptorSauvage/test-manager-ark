import { describe, expect, it } from 'vitest'
import { buildYearlyCron, lastOccurrenceAtOrBefore, isEventActive, msUntil } from '../shared/modEventSchedule'

describe('buildYearlyCron', () => {
  it('builds a 5-field cron firing every year on the given month/day/hour/minute', () => {
    expect(buildYearlyCron('2026-10-24T00:00:00')).toBe('0 0 24 10 *')
  })

  it('returns null for an unparseable date', () => {
    expect(buildYearlyCron('not a date')).toBeNull()
  })
})

describe('lastOccurrenceAtOrBefore', () => {
  it('non-recurring: returns the exact date if it is at or before now', () => {
    const now = new Date(2026, 9, 25)
    const result = lastOccurrenceAtOrBefore('2026-10-24T00:00:00', false, now)
    expect(result?.getTime()).toBe(new Date(2026, 9, 24).getTime())
  })

  it('non-recurring: returns null if the date is still in the future', () => {
    const now = new Date(2026, 9, 20)
    expect(lastOccurrenceAtOrBefore('2026-10-24T00:00:00', false, now)).toBeNull()
  })

  it('recurring: uses this year once it has passed', () => {
    const now = new Date(2026, 9, 25)
    const result = lastOccurrenceAtOrBefore('2020-10-24T00:00:00', true, now)
    expect(result?.getTime()).toBe(new Date(2026, 9, 24).getTime())
  })

  it('recurring: falls back to last year if this year has not happened yet', () => {
    const now = new Date(2026, 9, 20)
    const result = lastOccurrenceAtOrBefore('2020-10-24T00:00:00', true, now)
    expect(result?.getTime()).toBe(new Date(2025, 9, 24).getTime())
  })
})

describe('isEventActive', () => {
  it('is active between a non-recurring start and end', () => {
    const event = { startAt: '2026-10-24T00:00:00', endAt: '2026-11-03T23:59:00', recurringYearly: false }
    expect(isEventActive(event, new Date(2026, 9, 28))).toBe(true)
  })

  it('is inactive before the start', () => {
    const event = { startAt: '2026-10-24T00:00:00', endAt: '2026-11-03T23:59:00', recurringYearly: false }
    expect(isEventActive(event, new Date(2026, 9, 1))).toBe(false)
  })

  it('is inactive after the end', () => {
    const event = { startAt: '2026-10-24T00:00:00', endAt: '2026-11-03T23:59:00', recurringYearly: false }
    expect(isEventActive(event, new Date(2026, 10, 10))).toBe(false)
  })

  it('handles a recurring window that crosses the year boundary (Dec 18 -> Jan 5)', () => {
    const event = { startAt: '2020-12-18T00:00:00', endAt: '2020-01-05T23:59:00', recurringYearly: true }
    // Dec 27th: this year's Dec 18 start has fired, this year's Jan 5 end has not yet (last
    // year's has, but it's further in the past than the Dec 18 start) - active.
    expect(isEventActive(event, new Date(2026, 11, 27))).toBe(true)
    // Jan 2nd (into the new year): last year's Dec 18 start is still the most recent start,
    // but this year's Jan 5 end has not fired yet either - still active.
    expect(isEventActive(event, new Date(2027, 0, 2))).toBe(true)
    // Jan 10th: this year's Jan 5 end has now fired, more recently than last Dec's start -
    // inactive again.
    expect(isEventActive(event, new Date(2027, 0, 10))).toBe(false)
  })

  it('is active with no end yet reached for a one-time event', () => {
    const event = { startAt: '2026-10-24T00:00:00', endAt: '2099-01-01T00:00:00', recurringYearly: false }
    expect(isEventActive(event, new Date(2026, 9, 25))).toBe(true)
  })
})

describe('msUntil', () => {
  it('returns the positive delay to a future date', () => {
    const now = new Date(2026, 9, 24, 0, 0, 0)
    const target = new Date(2026, 9, 24, 0, 5, 0)
    expect(msUntil(target.toISOString(), now)).toBe(5 * 60_000)
  })

  it('returns null for a date at or before now', () => {
    const now = new Date(2026, 9, 24, 0, 0, 0)
    expect(msUntil(now.toISOString(), now)).toBeNull()
    expect(msUntil(new Date(2020, 0, 1).toISOString(), now)).toBeNull()
  })

  it('returns null for an unparseable date', () => {
    expect(msUntil('not a date', new Date())).toBeNull()
  })
})
