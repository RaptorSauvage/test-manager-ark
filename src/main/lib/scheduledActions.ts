import fs from 'node:fs'
import path from 'node:path'
import cron, { type ScheduledTask } from 'node-cron'
import type { ServerProfile } from '@shared/types'
import { buildDayOfWeekCron } from '@shared/scheduleTime'
import { isRunning, startServer, stopServer, setUpdating } from './serverProcess'
import { startMonitoring } from './monitor'
import { updateServer, getUpdateLogPath } from './steamcmd'
import { sendRconCommand } from './rcon'
import { getSettings } from '../store'
import { delay } from './delay'
import { logManagerEvent, newTaskId } from './managerLog'

const restartTasks = new Map<string, ScheduledTask>()
const dinoWipeTasks = new Map<string, ScheduledTask>()

/** Grace period between the server actually stopping and SteamCMD starting the update -
 *  gives the OS a moment to fully release the install directory's file handles (log file,
 *  save files) before SteamCMD starts touching them, avoiding a race where the update
 *  starts against files the just-killed process hasn't finished letting go of yet. */
const POST_STOP_UPDATE_DELAY_MS = 10_000

/** Appends a timestamped note to the same per-profile log the manual Update button's
 *  "View update log" reads, so a scheduled update's outcome - including a guard-clause
 *  rejection that never even got to spawn SteamCMD (no SteamCMD path set, server didn't
 *  actually stop, an update already running) - is visible without opening devtools. */
function logScheduledUpdateOutcome(profileId: string, message: string): void {
  const logPath = getUpdateLogPath(profileId)
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  fs.appendFileSync(logPath, `\n[${new Date().toISOString()}] ${message}\n`)
}

export async function runScheduledRestart(profile: ServerProfile): Promise<void> {
  if (!isRunning(profile.id)) return

  const taskId = newTaskId('scheduled-restart')
  const taskLabel = `Scheduled Restart — ${profile.name}`

  logManagerEvent(taskId, taskLabel, 'Stopping...')
  await stopServer(profile)
  logManagerEvent(taskId, taskLabel, 'Stopped')

  if (profile.scheduledRestartUpdateAfter) {
    // Reserved for the whole grace delay too, not just while SteamCMD is actually running -
    // doStartServer already refuses to start a server while isUpdating is set, so this also
    // blocks a manual Start during the 10s window between the shutdown and the update
    // actually beginning. Always released in the finally below, however this exits.
    setUpdating(profile.id, true)
    try {
      await delay(POST_STOP_UPDATE_DELAY_MS)
      logManagerEvent(taskId, taskLabel, 'Updating...')
      await updateServer(profile, getSettings().steamCmdPath, { skipInProgressGuard: true })
      logScheduledUpdateOutcome(profile.id, 'Scheduled update (after shutdown) completed successfully.')
      logManagerEvent(taskId, taskLabel, 'Update completed')
    } catch (err) {
      const message = (err as Error).message
      console.error(`Scheduled update failed for ${profile.name}:`, message)
      logScheduledUpdateOutcome(profile.id, `Scheduled update (after shutdown) failed: ${message}`)
      logManagerEvent(taskId, taskLabel, `Update failed: ${message}`, 'error')
    } finally {
      setUpdating(profile.id, false)
    }
  }

  if (profile.scheduledRestartStartAfter) {
    logManagerEvent(taskId, taskLabel, 'Starting...')
    startServer(profile)
    startMonitoring(profile)
    logManagerEvent(taskId, taskLabel, 'Started')
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
