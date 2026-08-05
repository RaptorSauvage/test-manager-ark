import type { ServerProfile, ServerStatus } from '@shared/types'
import {
  startServer,
  stopServer,
  stopServerPhased,
  restartServer,
  restartServerPhased,
  killServer,
  isRunning,
  isUpdating
} from './serverProcess'
import { startMonitoring, stopMonitoring } from './monitor'
import { updateServer } from './steamcmd'
import { getSettings } from '../store'
import { clearCachedGameVersion } from './serverVersion'

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

/** Like doStopServer, but resolves as soon as SaveWorld's outcome is confirmed instead of
 *  waiting out the whole shutdown - for a caller (the web dashboard's HTTP API) that wants
 *  a fast response while still being sure a save was actually attempted, rather than just
 *  "stopping was kicked off" with no idea whether SaveWorld ever happened. The rest of the
 *  shutdown keeps running in the background regardless. */
export async function doStopServerConfirmSave(profile: ServerProfile): Promise<{ saved: boolean }> {
  stopMonitoring(profile.id)
  const { saved, finished } = stopServerPhased(profile)
  finished.catch((err: Error) => console.error(`Background stop for ${profile.name} failed:`, err.message))
  return { saved: await saved }
}

export async function doRestartServer(profile: ServerProfile): Promise<ServerStatus> {
  const status = await restartServer(profile)
  startMonitoring(profile)
  return status
}

/** Restart's counterpart to doStopServerConfirmSave - resolves once the shutdown half's
 *  SaveWorld is confirmed, letting the server actually come back up in the background. */
export async function doRestartServerConfirmSave(profile: ServerProfile): Promise<{ saved: boolean }> {
  const { saved, finished } = restartServerPhased(profile)
  finished
    .then(() => startMonitoring(profile))
    .catch((err: Error) => console.error(`Background restart for ${profile.name} failed:`, err.message))
  return { saved: await saved }
}

export function doKillServer(profileId: string): ServerStatus {
  stopMonitoring(profileId)
  return killServer(profileId)
}

export async function doUpdateServer(profile: ServerProfile): Promise<void> {
  clearCachedGameVersion(profile.id)
  await updateServer(profile, getSettings().steamCmdPath)
}

/** Stops the server if it's running, updates it via SteamCMD, then starts it back up -
 *  the single-server equivalent of the dashboard's "Stop+Update+Restart All" bulk action. */
export async function doStopUpdateRestart(profile: ServerProfile): Promise<void> {
  if (isRunning(profile.id)) await doStopServer(profile)
  await doUpdateServer(profile)
  doStartServer(profile)
}
