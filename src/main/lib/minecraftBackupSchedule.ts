import { CronExpressionParser } from 'cron-parser'
import type { BackupScheduleStatus } from '@shared/types'
import type { MinecraftProfile, MinecraftRunState, MinecraftServerStatus } from '@shared/minecraft'
import { createMinecraftBackup, logMinecraftBackup } from './minecraftBackup'
import { isRunning, minecraftServerEvents } from './minecraftProcess'
import { getMinecraftProfile } from '../store'
import { logManagerEvent, newTaskId } from './managerLog'

/** Same self-arming setTimeout mechanism as ARK's own schedule.ts - see that file's own
 *  comment for the full reasoning (a single timer set to the exact next tick, re-armed after
 *  firing/skipping, rather than a library polling in the background). Kept as its own copy,
 *  not a shared generic, since ARK's version imports serverEvents/getProfile/createBackup -
 *  all ServerProfile-specific - and Minecraft's equivalents live in different modules. */

interface ArmedBackupSchedule {
  timer: NodeJS.Timeout
  nextRunAt: number
}

const armedSchedules = new Map<string, ArmedBackupSchedule>()

function nextRunAtFor(profile: MinecraftProfile): number | null {
  try {
    return CronExpressionParser.parse(profile.backupSchedule ?? '').next().getTime()
  } catch {
    return null
  }
}

function arm(profile: MinecraftProfile): void {
  const nextRunAt = nextRunAtFor(profile)
  if (nextRunAt === null) return

  const timer = setTimeout(
    () => {
      if (!isRunning(profile.id)) {
        logMinecraftBackup(profile.id, 'Scheduled backup skipped - server is not running.')
        logManagerEvent(newTaskId('mc-backup'), `Backup — ${profile.name}`, 'Skipped - server is not running.')
        armedSchedules.delete(profile.id)
        return
      }
      createMinecraftBackup(profile).catch((err: Error) => {
        console.error(`Scheduled backup failed for ${profile.name}:`, err.message)
      })
      arm(profile)
    },
    Math.max(0, nextRunAt - Date.now())
  )

  armedSchedules.set(profile.id, { timer, nextRunAt })
}

/** Arms the schedule, but only while the server is actually running - same reasoning as
 *  ARK's applyBackupSchedule. Call this on profile save and whenever the server's own status
 *  says it just started (handleStatusForMinecraftBackupSchedule). */
export function applyMinecraftBackupSchedule(profile: MinecraftProfile): void {
  clearMinecraftBackupSchedule(profile.id)
  if (!profile.backupScheduleEnabled || !profile.backupSchedule) return
  if (!isRunning(profile.id)) return
  arm(profile)
}

export function clearMinecraftBackupSchedule(profileId: string): void {
  const existing = armedSchedules.get(profileId)
  if (existing) {
    clearTimeout(existing.timer)
    armedSchedules.delete(profileId)
  }
}

export function getMinecraftBackupScheduleStatus(profile: MinecraftProfile): BackupScheduleStatus {
  const existing = armedSchedules.get(profile.id)
  if (!existing) return { active: false, nextRunAt: null }
  return { active: true, nextRunAt: existing.nextRunAt }
}

const lastKnownState = new Map<string, MinecraftRunState>()

export function handleStatusForMinecraftBackupSchedule(
  status: MinecraftServerStatus,
  lookupProfile: (id: string) => MinecraftProfile | undefined = getMinecraftProfile
): void {
  const previous = lastKnownState.get(status.profileId)
  lastKnownState.set(status.profileId, status.state)
  if (status.state === previous) return

  if (status.state === 'running') {
    const profile = lookupProfile(status.profileId)
    if (profile) applyMinecraftBackupSchedule(profile)
  } else {
    clearMinecraftBackupSchedule(status.profileId)
  }
}

export function registerMinecraftBackupScheduleWatcher(): void {
  minecraftServerEvents.on('status', (status: MinecraftServerStatus) => handleStatusForMinecraftBackupSchedule(status))
}
