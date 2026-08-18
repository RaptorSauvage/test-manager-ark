import fs from 'node:fs'
import path from 'node:path'
import cron, { type ScheduledTask } from 'node-cron'
import type { ServerProfile } from '@shared/types'
import { buildDayOfWeekCron } from '@shared/scheduleTime'
import { isRunning, startServer, stopServer } from './serverProcess'
import { startMonitoring } from './monitor'
import { updateServer, getUpdateLogPath } from './steamcmd'
import { sendRconCommand } from './rcon'
import { getSettings } from '../store'

const restartTasks = new Map<string, ScheduledTask>()
const dinoWipeTasks = new Map<string, ScheduledTask>()

/** Appends a timestamped note to the same per-profile log the manual Update button's
 *  "View update log" reads, so a scheduled update's outcome - including a guard-clause
 *  rejection that never even got to spawn SteamCMD (no SteamCMD path set, server didn't
 *  actually stop, an update already running) - is visible without opening devtools. */
function logScheduledUpdateOutcome(profileId: string, message: string): void {
  const logPath = getUpdateLogPath(profileId)
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  fs.appendFileSync(logPath, `\n[${new Date().toISOString()}] ${message}\n`)
}

async function runScheduledRestart(profile: ServerProfile): Promise<void> {
  if (!isRunning(profile.id)) return

  await stopServer(profile)

  if (profile.scheduledRestartUpdateAfter) {
    try {
      await updateServer(profile, getSettings().steamCmdPath)
      logScheduledUpdateOutcome(profile.id, 'Scheduled update (after shutdown) completed successfully.')
    } catch (err) {
      const message = (err as Error).message
      console.error(`Scheduled update failed for ${profile.name}:`, message)
      logScheduledUpdateOutcome(profile.id, `Scheduled update (after shutdown) failed: ${message}`)
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
