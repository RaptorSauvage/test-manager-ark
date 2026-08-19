import { CronExpressionParser } from 'cron-parser'
import type { BackupScheduleStatus, ServerProfile, ServerRunState, ServerStatus } from '@shared/types'
import { createBackup, logBackup } from './backup'
import { isRunning, serverEvents } from './serverProcess'
import { getProfile } from '../store'

interface ArmedBackupSchedule {
  timer: NodeJS.Timeout
  nextRunAt: number
}

const armedSchedules = new Map<string, ArmedBackupSchedule>()

/** Computes the next fire time from `profile.backupSchedule`, or null if it's missing/invalid. */
function nextRunAtFor(profile: ServerProfile): number | null {
  try {
    return CronExpressionParser.parse(profile.backupSchedule ?? '').next().getTime()
  } catch {
    return null
  }
}

/**
 * Arms a single setTimeout for the schedule's next fire time, re-arming itself for the
 * following one right after firing (or right after being skipped). A single self-managed
 * timer set to the exact next tick - rather than a library polling every second in the
 * background - so there's no ambiguity about whether it's actually still alive: this
 * module's own state (armedSchedules) is the only source of truth, and it's the same
 * value driving both the real timer and what getBackupScheduleStatus reports.
 */
function arm(profile: ServerProfile): void {
  const nextRunAt = nextRunAtFor(profile)
  if (nextRunAt === null) return

  const timer = setTimeout(
    () => {
      if (!isRunning(profile.id)) {
        // The schedule is only ever armed while the server is running (see
        // applyBackupSchedule/handleStatusForBackupSchedule below) - reaching this branch
        // means it stopped in the narrow race between arming and this exact tick firing,
        // since a normal stop clears the timer outright. Log it (visible in the Backups
        // tab's process log, so a skip is never silent) and just drop the armed entry
        // instead of re-arming - the schedule stays off until the server starts again,
        // same as if the stop had been noticed a moment earlier.
        logBackup(profile.id, 'Scheduled backup skipped - server is not running.')
        armedSchedules.delete(profile.id)
        return
      }
      createBackup(profile).catch((err: Error) => {
        console.error(`Scheduled backup failed for ${profile.name}:`, err.message)
      })
      arm(profile)
    },
    Math.max(0, nextRunAt - Date.now())
  )

  armedSchedules.set(profile.id, { timer, nextRunAt })
}

/**
 * Arms the schedule, but only while the server is actually running - a stopped server's
 * scheduled backup task is itself off, not just skipped when it happens to fire, so the
 * Analytics tab's "Backup Status" panel never claims a schedule is active for a server
 * that isn't. Call this on profile save (below) and whenever the server's own status says
 * it just started (handleStatusForBackupSchedule) - between the two, the schedule tracks
 * the server's running state directly instead of ticking uselessly in the background the
 * whole time it's offline.
 */
export function applyBackupSchedule(profile: ServerProfile): void {
  clearBackupSchedule(profile.id)
  if (!profile.backupScheduleEnabled || !profile.backupSchedule) return
  if (!isRunning(profile.id)) return
  arm(profile)
}

export function clearBackupSchedule(profileId: string): void {
  const existing = armedSchedules.get(profileId)
  if (existing) {
    clearTimeout(existing.timer)
    armedSchedules.delete(profileId)
  }
}

/** Whether a profile's backup schedule is actually active, and when it next fires - for
 *  the Analytics tab's "Backup Status" panel. Reads directly off the armed timer's own
 *  state, so it can never claim "active" while the real timer isn't actually set. */
export function getBackupScheduleStatus(profile: ServerProfile): BackupScheduleStatus {
  const existing = armedSchedules.get(profile.id)
  if (!existing) return { active: false, nextRunAt: null }
  return { active: true, nextRunAt: existing.nextRunAt }
}

const lastKnownState = new Map<string, ServerRunState>()

/**
 * Arms a profile's backup schedule the moment its status actually transitions to
 * 'running', and clears it the moment it leaves 'running' - so the task turns on and off
 * with the server itself instead of sitting armed (and reporting "active") the whole time
 * it's offline. Edge-triggered (the state actually changed), not level-triggered, so the
 * routine 5s status ticks monitor.ts emits for an already-running server don't re-arm the
 * timer on every single one - just once per actual transition.
 */
export function handleStatusForBackupSchedule(
  status: ServerStatus,
  lookupProfile: (id: string) => ServerProfile | undefined = getProfile
): void {
  const previous = lastKnownState.get(status.profileId)
  lastKnownState.set(status.profileId, status.state)
  if (status.state === previous) return

  if (status.state === 'running') {
    const profile = lookupProfile(status.profileId)
    if (profile) applyBackupSchedule(profile)
  } else {
    clearBackupSchedule(status.profileId)
  }
}

export function registerBackupScheduleWatcher(): void {
  serverEvents.on('status', (status: ServerStatus) => handleStatusForBackupSchedule(status))
}
