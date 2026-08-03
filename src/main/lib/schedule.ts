import { CronExpressionParser } from 'cron-parser'
import type { BackupScheduleStatus, ServerProfile } from '@shared/types'
import { createBackup, logBackup } from './backup'
import { isRunning } from './serverProcess'

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
        // A scheduled run only actually backs up while the server is online -
        // createBackup() itself will happily zip a stopped server's (possibly long-stale)
        // files too, which is exactly what you want for a deliberate one-off "Create
        // backup now" click, but not for an unattended hourly/daily job silently
        // re-zipping the same unchanged files over and over while the server sits
        // offline between runs. Logged either way (visible in the Backups tab's process
        // log) so a skip is never silent.
        logBackup(profile.id, 'Scheduled backup skipped - server is not running.')
      } else {
        createBackup(profile).catch((err: Error) => {
          console.error(`Scheduled backup failed for ${profile.name}:`, err.message)
        })
      }
      arm(profile)
    },
    Math.max(0, nextRunAt - Date.now())
  )

  armedSchedules.set(profile.id, { timer, nextRunAt })
}

export function applyBackupSchedule(profile: ServerProfile): void {
  clearBackupSchedule(profile.id)
  if (!profile.backupScheduleEnabled || !profile.backupSchedule) return
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
