import cron, { type ScheduledTask } from 'node-cron'
import type { ServerProfile, ServerStatus } from '@shared/types'
import { buildDayOfWeekCron } from '@shared/scheduleTime'
import { isRunning, startServer, stopServer, serverEvents } from './serverProcess'
import { startMonitoring } from './monitor'
import { updateServer } from './steamcmd'
import { sendRconCommand } from './rcon'
import { getSettings } from '../store'

const restartTasks = new Map<string, ScheduledTask>()
const dinoWipeTasks = new Map<string, ScheduledTask>()

/** Resolves true once the profile's status becomes 'running', or false if it doesn't
 *  within `timeoutMs` (a crash/error mid-startup shouldn't hang this forever). */
function waitUntilRunning(profileId: string, timeoutMs = 10 * 60 * 1000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      serverEvents.off('status', handler)
      resolve(result)
    }
    const handler = (status: ServerStatus): void => {
      if (status.profileId === profileId && status.state === 'running') finish(true)
    }
    const timeout = setTimeout(() => finish(false), timeoutMs)
    serverEvents.on('status', handler)
  })
}

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

    if (profile.scheduledRestartDestroyWildDinosAfter) {
      const becameRunning = await waitUntilRunning(profile.id)
      if (becameRunning) {
        const result = await sendRconCommand(profile, 'DestroyWildDinos')
        if (!result.ok) {
          console.error(`DestroyWildDinos after scheduled restart failed for ${profile.name}:`, result.error)
        }
      }
    }
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
