import fs from 'node:fs'
import path from 'node:path'
import cron, { type ScheduledTask } from 'node-cron'
import type { ServerProfile, ScheduledRconCommand } from '@shared/types'
import { buildDayOfWeekCron } from '@shared/scheduleTime'
import { isRunning, startServer, stopServer, setUpdating } from './serverProcess'
import { startMonitoring } from './monitor'
import { updateServer, getUpdateLogPath } from './steamcmd'
import { sendRconCommand, listPlayers } from './rcon'
import { createBackup } from './backup'
import { getSettings } from '../store'
import { delay } from './delay'
import { logManagerEvent, newTaskId } from './managerLog'

const restartTasks = new Map<string, ScheduledTask>()
const dinoWipeTasks = new Map<string, ScheduledTask>()
const maintenanceTasks = new Map<string, ScheduledTask>()
// Keyed by `${profileId}::${entryId}`, not just profileId - unlike restart/dino wipe, a
// profile can have any number of these at once. 'fixedTime' entries live in node-cron tasks
// (rconCommandTasks); 'interval' entries are plain setInterval timers (rconIntervalTasks) -
// different enough underlying primitives that they're not worth forcing into one Map.
// 'timeless' entries never get an entry in either - nothing to schedule, by definition.
const rconCommandTasks = new Map<string, ScheduledTask>()
const rconIntervalTasks = new Map<string, ReturnType<typeof setInterval>>()

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

  if (profile.scheduledRestartOnlyIfEmpty) {
    const players = await listPlayers(profile)
    if (players.length > 0) {
      logManagerEvent(
        taskId,
        taskLabel,
        `Skipped - ${players.length} player${players.length === 1 ? '' : 's'} still connected (will try again at the next occurrence).`
      )
      return
    }
  }

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

/** Whether `entry.playerRequirement` allows a fire to actually go through right now. Checked
 *  inside the fire callback (not at schedule-registration time), same as `isRunning` already
 *  is for every trigger type here - the player count can only ever be known at the moment
 *  the trigger actually goes off. */
async function playerRequirementSatisfied(profile: ServerProfile, requirement: ScheduledRconCommand['playerRequirement']): Promise<boolean> {
  if (requirement === 'always') return true
  const players = await listPlayers(profile)
  return requirement === 'onlyIfEmpty' ? players.length === 0 : players.length > 0
}

async function fireScheduledRconCommand(profile: ServerProfile, entry: ScheduledRconCommand): Promise<void> {
  if (!isRunning(profile.id)) return
  if (!(await playerRequirementSatisfied(profile, entry.playerRequirement))) return
  const result = await sendRconCommand(profile, entry.command)
  if (!result.ok) {
    console.error(`Scheduled RCON command "${entry.label || entry.command}" failed for ${profile.name}:`, result.error)
  }
}

/** Generic RCON command scheduler - any number of entries per profile, each with its own
 *  trigger (MCSS-inspired, adapted to ARK): 'fixedTime' uses the same node-cron mechanism as
 *  the dino wipe schedule above; 'interval' is a plain setInterval that keeps firing every
 *  `intervalSeconds` for as long as the server's running (not a one-shot delay-after-start);
 *  'timeless' is never scheduled at all - see runScheduledRconCommandNow for its only way to
 *  actually fire. */
export function applyScheduledRconCommands(profile: ServerProfile): void {
  clearScheduledRconCommands(profile.id)

  // Guarded the same way buildDayOfWeekCron guards its own `days` param - a profile saved
  // through a path that doesn't go through migrateProfile (some test fixtures, or a raw
  // partial patch) can still reach here with this field missing at runtime despite the type.
  for (const entry of profile.scheduledRconCommands ?? []) {
    if (!entry.enabled || !entry.command.trim()) continue

    if (entry.triggerType === 'interval') {
      if (!entry.intervalSeconds || entry.intervalSeconds <= 0) continue
      const timer = setInterval(() => {
        void fireScheduledRconCommand(profile, entry)
      }, entry.intervalSeconds * 1000)
      rconIntervalTasks.set(`${profile.id}::${entry.id}`, timer)
      continue
    }

    if (entry.triggerType === 'timeless') continue

    const cronExpr = buildDayOfWeekCron(entry.time, entry.days)
    if (!cronExpr || !cron.validate(cronExpr)) continue
    const task = cron.schedule(cronExpr, () => {
      void fireScheduledRconCommand(profile, entry)
    })
    rconCommandTasks.set(`${profile.id}::${entry.id}`, task)
  }
}

export function clearScheduledRconCommands(profileId: string): void {
  for (const [key, task] of rconCommandTasks) {
    if (!key.startsWith(`${profileId}::`)) continue
    task.stop()
    rconCommandTasks.delete(key)
  }
  for (const [key, timer] of rconIntervalTasks) {
    if (!key.startsWith(`${profileId}::`)) continue
    clearInterval(timer)
    rconIntervalTasks.delete(key)
  }
}

/** Chained maintenance task: Stop → Backup → Update → Start, a single fixed pipeline (see
 *  ServerProfile.scheduledMaintenanceEnabled's own doc comment for why this isn't built as
 *  separately toggleable steps the way the restart schedule's own update/start options are).
 *  A backup failure is logged but doesn't abort the chain - the update and restart matter
 *  more than one missed backup, and createBackup already has its own retry-by-waiting-for-
 *  the-next-scheduled-backup story via the regular backup schedule. */
export async function runScheduledMaintenance(profile: ServerProfile): Promise<void> {
  if (!isRunning(profile.id)) return

  const taskId = newTaskId('scheduled-maintenance')
  const taskLabel = `Scheduled Maintenance — ${profile.name}`

  logManagerEvent(taskId, taskLabel, 'Stopping...')
  await stopServer(profile)
  logManagerEvent(taskId, taskLabel, 'Stopped')

  logManagerEvent(taskId, taskLabel, 'Backing up...')
  try {
    await createBackup(profile)
    logManagerEvent(taskId, taskLabel, 'Backup completed')
  } catch (err) {
    const message = (err as Error).message
    console.error(`Scheduled maintenance backup failed for ${profile.name}:`, message)
    logManagerEvent(taskId, taskLabel, `Backup failed: ${message}`, 'error')
  }

  setUpdating(profile.id, true)
  try {
    await delay(POST_STOP_UPDATE_DELAY_MS)
    logManagerEvent(taskId, taskLabel, 'Updating...')
    await updateServer(profile, getSettings().steamCmdPath, { skipInProgressGuard: true })
    logScheduledUpdateOutcome(profile.id, 'Scheduled maintenance update completed successfully.')
    logManagerEvent(taskId, taskLabel, 'Update completed')
  } catch (err) {
    const message = (err as Error).message
    console.error(`Scheduled maintenance update failed for ${profile.name}:`, message)
    logScheduledUpdateOutcome(profile.id, `Scheduled maintenance update failed: ${message}`)
    logManagerEvent(taskId, taskLabel, `Update failed: ${message}`, 'error')
  } finally {
    setUpdating(profile.id, false)
  }

  logManagerEvent(taskId, taskLabel, 'Starting...')
  startServer(profile)
  startMonitoring(profile)
  logManagerEvent(taskId, taskLabel, 'Started')
}

export function applyScheduledMaintenance(profile: ServerProfile): void {
  clearScheduledMaintenance(profile.id)
  if (!profile.scheduledMaintenanceEnabled) return

  const cronExpr = buildDayOfWeekCron(profile.scheduledMaintenanceTime, profile.scheduledMaintenanceDays)
  if (!cronExpr || !cron.validate(cronExpr)) return

  const task = cron.schedule(cronExpr, () => {
    void runScheduledMaintenance(profile)
  })
  maintenanceTasks.set(profile.id, task)
}

export function clearScheduledMaintenance(profileId: string): void {
  const task = maintenanceTasks.get(profileId)
  if (task) {
    task.stop()
    maintenanceTasks.delete(profileId)
  }
}
