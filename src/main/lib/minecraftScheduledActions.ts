import cron, { type ScheduledTask } from 'node-cron'
import type { MinecraftProfile } from '@shared/minecraft'
import { buildDayOfWeekCron } from '@shared/scheduleTime'
import { isRunning } from './minecraftProcess'
import { doStartMinecraftServer, doStopMinecraftServer } from './minecraftActions'
import { logManagerEvent, newTaskId } from './managerLog'

/** Same day-of-week + time cron mechanism as ARK's own scheduledActions.ts - only the
 *  restart half of it, since Minecraft has no SteamCMD-equivalent update step (ARK's dino
 *  wipe schedule has no Minecraft equivalent either, so this file is deliberately smaller
 *  than that one, not a partial port of it). */

const restartTasks = new Map<string, ScheduledTask>()

export async function runMinecraftScheduledRestart(profile: MinecraftProfile): Promise<void> {
  if (!isRunning(profile.id)) return

  const taskId = newTaskId('mc-scheduled-restart')
  const taskLabel = `Scheduled Restart — ${profile.name}`

  logManagerEvent(taskId, taskLabel, 'Stopping...')
  await doStopMinecraftServer(profile)
  logManagerEvent(taskId, taskLabel, 'Stopped')

  if (profile.scheduledRestartStartAfter) {
    logManagerEvent(taskId, taskLabel, 'Starting...')
    doStartMinecraftServer(profile)
    logManagerEvent(taskId, taskLabel, 'Started')
  }
}

export function applyMinecraftScheduledRestart(profile: MinecraftProfile): void {
  clearMinecraftScheduledRestart(profile.id)
  if (!profile.scheduledRestartEnabled) return

  const cronExpr = buildDayOfWeekCron(profile.scheduledRestartTime, profile.scheduledRestartDays)
  if (!cronExpr || !cron.validate(cronExpr)) return

  const task = cron.schedule(cronExpr, () => {
    void runMinecraftScheduledRestart(profile)
  })
  restartTasks.set(profile.id, task)
}

export function clearMinecraftScheduledRestart(profileId: string): void {
  const task = restartTasks.get(profileId)
  if (task) {
    task.stop()
    restartTasks.delete(profileId)
  }
}
