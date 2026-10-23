import type { ModEvent, ModEventAction } from '@shared/types'

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

export interface EventBoundary {
  /** The instant this boundary occurred (a past start or end trigger). */
  at: Date
  action: ModEventAction
}

/**
 * The most recent start-or-end trigger that has already happened, and which action it
 * implies - the single source of truth both isEventActive below and the scheduling engine's
 * own reconciliation (src/main/lib/modEvents.ts's reconcile()) build on. Null if neither has
 * happened yet (a one-time event whose start is still in the future).
 *
 * Correctly handles a window that crosses a year boundary (e.g. Dec 18 -> Jan 5) without any
 * special-casing: start and end are each just their own independently-recurring point in
 * time, and whichever one most recently fired wins.
 */
export function mostRecentBoundary(event: Pick<ModEvent, 'startAt' | 'endAt' | 'recurringYearly'>, now: Date): EventBoundary | null {
  const lastStart = lastOccurrenceAtOrBefore(event.startAt, event.recurringYearly, now)
  const lastEnd = lastOccurrenceAtOrBefore(event.endAt, event.recurringYearly, now)
  if (!lastStart) return lastEnd ? { at: lastEnd, action: 'deactivated' } : null
  if (!lastEnd) return { at: lastStart, action: 'activated' }
  return lastStart.getTime() > lastEnd.getTime() ? { at: lastStart, action: 'activated' } : { at: lastEnd, action: 'deactivated' }
}

/** Whether the event's mods should currently be applied - see mostRecentBoundary above.
 *  Used for the Event Scheduler table's Status column (Active/Scheduled); the scheduling
 *  engine itself uses mostRecentBoundary directly, since reconciliation also needs the exact
 *  boundary instant, not just which side of it "now" falls on. */
export function isEventActive(event: Pick<ModEvent, 'startAt' | 'endAt' | 'recurringYearly'>, now: Date): boolean {
  return mostRecentBoundary(event, now)?.action === 'activated'
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
