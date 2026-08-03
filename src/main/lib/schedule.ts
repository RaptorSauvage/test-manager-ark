import cron, { type ScheduledTask } from 'node-cron'
import { CronExpressionParser } from 'cron-parser'
import type { BackupScheduleStatus, ServerProfile } from '@shared/types'
import { createBackup } from './backup'

const scheduledTasks = new Map<string, ScheduledTask>()

export function applyBackupSchedule(profile: ServerProfile): void {
  const existing = scheduledTasks.get(profile.id)
  if (existing) {
    existing.stop()
    scheduledTasks.delete(profile.id)
  }

  if (!profile.backupScheduleEnabled || !profile.backupSchedule || !cron.validate(profile.backupSchedule)) return

  // createBackup() already checks isRunning itself and logs why it cancelled (visible in
  // the Backups tab's process log) - a separate pre-check here used to just console.log
  // and return, which meant a skipped run left no trace anywhere in the app itself.
  const task = cron.schedule(profile.backupSchedule, () => {
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
