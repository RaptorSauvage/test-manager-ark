import type { ServerProfile, ServerStatus } from '@shared/types'
import { startServer, stopServer, restartServer, killServer, isRunning, isUpdating } from './serverProcess'
import { startMonitoring, stopMonitoring } from './monitor'
import { updateServer } from './steamcmd'
import { getSettings } from '../store'

/** Orchestration shared by the IPC handlers (desktop app) and the web dashboard's server
 *  controls, so both stay in sync on what "start", "stop", etc. actually involve (starting/
 *  stopping the CPU/RAM monitor alongside the process itself). */

export function doStartServer(profile: ServerProfile): ServerStatus {
  if (isUpdating(profile.id)) throw new Error('Cannot start the server while an update is in progress.')
  const status = startServer(profile)
  startMonitoring(profile)
  return status
}

export async function doStopServer(profile: ServerProfile): Promise<ServerStatus> {
  stopMonitoring(profile.id)
  return stopServer(profile)
}

export async function doRestartServer(profile: ServerProfile): Promise<ServerStatus> {
  const status = await restartServer(profile)
  startMonitoring(profile)
  return status
}

export function doKillServer(profileId: string): ServerStatus {
  stopMonitoring(profileId)
  return killServer(profileId)
}

export async function doUpdateServer(profile: ServerProfile): Promise<void> {
  await updateServer(profile, getSettings().steamCmdPath)
}

/** Stops the server if it's running, updates it via SteamCMD, then starts it back up -
 *  the single-server equivalent of the dashboard's "Stop+Update+Restart All" bulk action. */
export async function doStopUpdateRestart(profile: ServerProfile): Promise<void> {
  if (isRunning(profile.id)) await doStopServer(profile)
  await doUpdateServer(profile)
  doStartServer(profile)
}
