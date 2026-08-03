import cron, { type ScheduledTask } from 'node-cron'
import { CronExpressionParser } from 'cron-parser'
import type { BackupScheduleStatus, ServerProfile } from '@shared/types'
import { createBackup, logBackup } from './backup'
import { isRunning } from './serverProcess'

const scheduledTasks = new Map<string, ScheduledTask>()

export function applyBackupSchedule(profile: ServerProfile): void {
  const existing = scheduledTasks.get(profile.id)
  if (existing) {
    existing.stop()
    scheduledTasks.delete(profile.id)
  }

  if (!profile.backupScheduleEnabled || !profile.backupSchedule || !cron.validate(profile.backupSchedule)) return

  // A scheduled run only actually backs up while the server is online - createBackup()
  // itself will happily zip a stopped server's (possibly long-stale) files too, which is
  // exactly what you want for a deliberate one-off "Create backup now" click, but not for
  // an unattended hourly/daily job silently re-zipping the same unchanged files over and
  // over while the server sits offline between runs. Logged either way (visible in the
  // Backups tab's process log) so a skip is never silent - see the isRunning check inside
  // createBackup() itself for why that pre-check used to just console.log and return.
  const task = cron.schedule(profile.backupSchedule, () => {
    if (!isRunning(profile.id)) {
      logBackup(profile.id, 'Scheduled backup skipped - server is not running.')
      return
    }
    createBackup(profile).catch((err: Error) => {
      console.error(`Scheduled backup failed for ${profile.name}:`, err.message)
    })
  })
  scheduledTasks.set(profile.id, task)
}

export function clearBackupSchedule(profileId: string): void {
  const existing = scheduledTasks.get(profileId)
  if (existing) {
    existing.stop()
    scheduledTasks.delete(profileId)
  }
}

/** Whether a profile's backup schedule is actually active, and when it next fires - for
 *  the Analytics tab's "Backup Status" panel. Purely computed from the profile + a fresh
 *  cron-parser read, not from any state stored by the scheduler itself. */
export function getBackupScheduleStatus(profile: ServerProfile): BackupScheduleStatus {
  const active = scheduledTasks.has(profile.id)
  if (!active) return { active: false, nextRunAt: null }

  try {
    const nextRunAt = CronExpressionParser.parse(profile.backupSchedule ?? '').next().getTime()
    return { active: true, nextRunAt }
  } catch {
    return { active: true, nextRunAt: null }
  }
}
