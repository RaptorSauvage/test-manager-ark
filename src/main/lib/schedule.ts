import cron, { type ScheduledTask } from 'node-cron'
import type { ServerProfile } from '@shared/types'
import { createBackup } from './backup'
import { isRunning } from './serverProcess'

const scheduledTasks = new Map<string, ScheduledTask>()

export function applyBackupSchedule(profile: ServerProfile): void {
  const existing = scheduledTasks.get(profile.id)
  if (existing) {
    existing.stop()
    scheduledTasks.delete(profile.id)
  }

  if (!profile.backupScheduleEnabled || !profile.backupSchedule || !cron.validate(profile.backupSchedule)) return

  const task = cron.schedule(profile.backupSchedule, () => {
    if (!isRunning(profile.id)) {
      console.log(`Skipping scheduled backup for ${profile.name}: server is not running.`)
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
