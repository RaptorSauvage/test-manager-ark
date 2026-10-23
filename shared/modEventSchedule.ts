import type { ModEvent } from '@shared/types'

/** Pure date math for the Event Scheduler - kept free of any store/process imports so it's
 *  trivially unit-testable, same split as shared/scheduleTime.ts (pure) vs
 *  scheduledActions.ts (stateful). All local-time, matching the rest of the app's scheduling
 *  (node-cron runs in the system's local timezone by default, and buildDayOfWeekCron already
 *  works the same way). */

interface DateComponents {
  month: number
  day: number
  hour: number
  minute: number
}

function componentsOf(iso: string): DateComponents | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return { month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() }
}

/** 5-field cron expression firing every year at `iso`'s month/day/hour/minute (the stored
 *  year itself is ignored) - the weekday field is left wild. Null if `iso` doesn't parse. */
export function buildYearlyCron(iso: string): string | null {
  const c = componentsOf(iso)
  if (!c) return null
  return `${c.minute} ${c.hour} ${c.day} ${c.month} *`
}

/** The most recent local-time occurrence of `iso` at or before `now`: for a recurring event,
 *  this year's occurrence of its month/day/hour/minute if that's already passed, otherwise
 *  last year's (so there's always one, however long ago); for a one-time event, `iso` itself
 *  if it's at or before `now`, otherwise null (it hasn't happened yet). */
export function lastOccurrenceAtOrBefore(iso: string, recurringYearly: boolean, now: Date): Date | null {
  const exact = new Date(iso)
  if (Number.isNaN(exact.getTime())) return null
  if (!recurringYearly) return exact <= now ? exact : null

  const c = componentsOf(iso)
  if (!c) return null
  const thisYear = new Date(now.getFullYear(), c.month - 1, c.day, c.hour, c.minute, 0, 0)
  return thisYear <= now ? thisYear : new Date(now.getFullYear() - 1, c.month - 1, c.day, c.hour, c.minute, 0, 0)
}

/**
 * Whether the event's mods should currently be applied: the most recent start trigger
 * happened more recently than the most recent end trigger. This is what lets the Event
 * Scheduler reconcile state on arm (app startup, an event just saved/enabled) regardless of
 * how long the Manager was closed or the event was disabled - it isn't only "did a timer
 * happen to fire while something was listening". Also doubles as the Status column's
 * Active/Scheduled distinction in the UI.
 *
 * Correctly handles a window that crosses a year boundary (e.g. Dec 18 -> Jan 5) without any
 * special-casing: start and end are each just their own independently-recurring point in
 * time, and whichever one most recently fired determines the current state.
 */
export function isEventActive(event: Pick<ModEvent, 'startAt' | 'endAt' | 'recurringYearly'>, now: Date): boolean {
  const lastStart = lastOccurrenceAtOrBefore(event.startAt, event.recurringYearly, now)
  if (!lastStart) return false
  const lastEnd = lastOccurrenceAtOrBefore(event.endAt, event.recurringYearly, now)
  if (!lastEnd) return true
  return lastStart.getTime() > lastEnd.getTime()
}

/** Milliseconds from `now` until `iso`'s exact instant, or null if it's already passed. Only
 *  meaningful for a non-recurring trigger - a recurring one is armed via buildYearlyCron
 *  instead, which needs no "next occurrence" computed up front. */
export function msUntil(iso: string, now: Date): number | null {
  const target = new Date(iso)
  if (Number.isNaN(target.getTime())) return null
  const diff = target.getTime() - now.getTime()
  return diff > 0 ? diff : null
}
