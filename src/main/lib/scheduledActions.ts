import cron, { type ScheduledTask } from 'node-cron'
import type { ServerProfile } from '@shared/types'
import { buildDayOfWeekCron } from '@shared/scheduleTime'
import { isRunning, startServer, stopServer } from './serverProcess'
import { startMonitoring } from './monitor'
import { updateServer } from './steamcmd'
import { sendRconCommand } from './rcon'
import { getSettings } from '../store'

const restartTasks = new Map<string, ScheduledTask>()
const dinoWipeTasks = new Map<string, ScheduledTask>()

async function runScheduledRestart(profile: ServerProfile): Promise<void> {
  if (!isRunning(profile.id)) return

  await stopServer(profile)

  if (profile.scheduledRestartUpdateAfter) {
    try {
      await updateServer(profile, getSettings().steamCmdPath)
    } catch (err) {
      console.error(`Scheduled update failed for ${profile.name}:`, (err as Error).message)
    }
  }

  if (profile.scheduledRestartStartAfter) {
    startServer(profile)
    startMonitoring(profile)
  }
}

export function applyScheduledRestart(profile: ServerProfile): void {
  clearScheduledRestart(profile.id)
  if (!profile.scheduledRestartEnabled) return

  const cronExpr = buildDayOfWeekCron(profile.scheduledRestartTime, profile.scheduledRestartDays)
  if (!cronExpr || !cron.validate(cronExpr)) return

  const task = cron.schedule(cronExpr, () => {
    void runScheduledRestart(profile)
  })
  restartTasks.set(profile.id, task)
}

export function clearScheduledRestart(profileId: string): void {
  const task = restartTasks.get(profileId)
  if (task) {
    task.stop()
    restartTasks.delete(profileId)
  }
}

export function applyScheduledDinoWipe(profile: ServerProfile): void {
  clearScheduledDinoWipe(profile.id)
  if (!profile.scheduledDinoWipeEnabled) return

  const cronExpr = buildDayOfWeekCron(profile.scheduledDinoWipeTime, profile.scheduledDinoWipeDays)
  if (!cronExpr || !cron.validate(cronExpr)) return

  const task = cron.schedule(cronExpr, () => {
    if (!isRunning(profile.id)) return
    void sendRconCommand(profile, 'DestroyWildDinos').then((result) => {
      if (!result.ok) console.error(`Scheduled dino wipe failed for ${profile.name}:`, result.error)
    })
  })
  dinoWipeTasks.set(profile.id, task)
}

export function clearScheduledDinoWipe(profileId: string): void {
  const task = dinoWipeTasks.get(profileId)
  if (task) {
    task.stop()
    dinoWipeTasks.delete(profileId)
  }
}
