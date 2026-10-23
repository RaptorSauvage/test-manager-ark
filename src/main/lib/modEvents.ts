import { randomUUID } from 'node:crypto'
import cron, { type ScheduledTask } from 'node-cron'
import type { ModEvent, ModEventAction } from '@shared/types'
import { listModEvents, listProfiles, saveProfile, recordModEventHistory } from '../store'
import { isRunning, startServer, stopServer } from './serverProcess'
import { startMonitoring } from './monitor'
import { syncAseModsToIni } from './gameConfigWrite'
import { logManagerEvent, newTaskId } from './managerLog'
import { buildYearlyCron, isEventActive, msUntil } from '@shared/modEventSchedule'

interface ArmedEvent {
  startTask?: ScheduledTask
  endTask?: ScheduledTask
  startTimer?: NodeJS.Timeout
  endTimer?: NodeJS.Timeout
}

const armed = new Map<string, ArmedEvent>()

/** Adds (action 'activated') or removes ('deactivated') `event.modIds` on every target
 *  profile's own mod list - idempotent, so re-running this for a target that's already in
 *  the right state (a reconciliation pass that finds nothing to do, or a profile that
 *  already has every event mod) is a safe no-op: no save, no shutdown/restart cycle, no
 *  history entry for that target. Per-target failures don't stop the rest of the targets
 *  from being processed, and are recorded alongside whatever did succeed rather than
 *  aborting the whole firing. */
export async function applyModEventChange(event: ModEvent, action: ModEventAction): Promise<void> {
  const profiles = listProfiles()
  const targets = event.targetServers === 'all' ? profiles : profiles.filter((p) => event.targetServers.includes(p.id))

  const profileIds: string[] = []
  const errors: Record<string, string> = {}
  let anyChanged = false

  for (const profile of targets) {
    try {
      const currentIds = new Set(profile.mods.map((m) => m.id))
      let nextMods = profile.mods
      if (action === 'activated') {
        const missing = event.modIds.filter((id) => !currentIds.has(id))
        if (missing.length === 0) continue
        nextMods = [...profile.mods, ...missing.map((id) => ({ id, enabled: true, passive: false, dev: false }))]
      } else {
        if (!event.modIds.some((id) => currentIds.has(id))) continue
        nextMods = profile.mods.filter((m) => !event.modIds.includes(m.id))
      }

      const updated = { ...profile, mods: nextMods }
      saveProfile(updated)
      // ARK: Survival Evolved has no command-line mechanism for mods - same follow-up the
      // Mods tab's own save IPC handler does (see ipc/mods.ts); a no-op for ARK: Survival
      // Ascended.
      syncAseModsToIni(updated)
      anyChanged = true
      profileIds.push(profile.id)

      const shouldCycle = action === 'activated' ? event.shutdownOnStart : event.shutdownOnEnd
      if (shouldCycle && isRunning(profile.id)) {
        await stopServer(updated)
        startServer(updated)
        startMonitoring(updated)
      }
    } catch (err) {
      profileIds.push(profile.id)
      errors[profile.id] = (err as Error).message
      console.error(`Event Scheduler: failed to apply "${event.name}" (${action}) to ${profile.name}:`, (err as Error).message)
    }
  }

  if (!anyChanged && Object.keys(errors).length === 0) return

  recordModEventHistory({
    id: randomUUID(),
    eventId: event.id,
    eventName: event.name,
    action,
    timestamp: Date.now(),
    profileIds,
    errors: Object.keys(errors).length > 0 ? errors : undefined
  })
  logManagerEvent(
    newTaskId('mod-event'),
    `Event Scheduler — ${event.name}`,
    action === 'activated' ? `Mod(s) added: ${event.modIds.join(', ')}` : `Mod(s) removed: ${event.modIds.join(', ')}`,
    Object.keys(errors).length > 0 ? 'error' : 'info'
  )
}

function clearArmed(eventId: string): void {
  const existing = armed.get(eventId)
  if (!existing) return
  existing.startTask?.stop()
  existing.endTask?.stop()
  if (existing.startTimer) clearTimeout(existing.startTimer)
  if (existing.endTimer) clearTimeout(existing.endTimer)
  armed.delete(eventId)
}

/**
 * (Re-)arms one event's start/end triggers and, before doing so, reconciles the target
 * servers' mod lists against whether the event is in-season right now (see isEventActive's
 * own doc comment) - so calling this on every app startup and every event save/enable is
 * enough to stay correct no matter how long the Manager, or the event itself, was off.
 *
 * A recurring event's triggers are node-cron jobs (fire forever, once a year each - no
 * self-re-arming needed). A one-time event's triggers are plain setTimeouts to the exact
 * instant, only set when that instant is still in the future; once it fires there's no next
 * occurrence, so nothing re-arms it.
 */
export function armModEvent(event: ModEvent): void {
  clearArmed(event.id)
  if (!event.enabled) return

  const now = new Date()
  void applyModEventChange(event, isEventActive(event, now) ? 'activated' : 'deactivated')

  const next: ArmedEvent = {}
  if (event.recurringYearly) {
    const startCron = buildYearlyCron(event.startAt)
    if (startCron && cron.validate(startCron)) {
      next.startTask = cron.schedule(startCron, () => void applyModEventChange(event, 'activated'))
    }
    const endCron = buildYearlyCron(event.endAt)
    if (endCron && cron.validate(endCron)) {
      next.endTask = cron.schedule(endCron, () => void applyModEventChange(event, 'deactivated'))
    }
  } else {
    const startDelay = msUntil(event.startAt, now)
    if (startDelay !== null) {
      next.startTimer = setTimeout(() => void applyModEventChange(event, 'activated'), startDelay)
    }
    const endDelay = msUntil(event.endAt, now)
    if (endDelay !== null) {
      next.endTimer = setTimeout(() => void applyModEventChange(event, 'deactivated'), endDelay)
    }
  }
  armed.set(event.id, next)
}

export function disarmModEvent(eventId: string): void {
  clearArmed(eventId)
}

/** Called once at app startup (main/index.ts) - arms every currently-saved event, which
 *  also runs each one's reconciliation pass so a Manager that was closed through an event's
 *  start (or end) still ends up with the right mods present (or removed) immediately. */
export function armAllModEvents(): void {
  for (const event of listModEvents()) armModEvent(event)
}
