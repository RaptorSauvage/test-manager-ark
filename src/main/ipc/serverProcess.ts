import { ipcMain, type WebContents } from 'electron'
import { IPC } from '@shared/types'
import { getProfile } from '../store'
import { getStatus, serverEvents } from '../lib/serverProcess'
import { doStartServer, doStopServer, doRestartServer, doKillServer, doUpdateServer } from '../lib/serverActions'
import { isValidArkInstall } from '../lib/detect'
import { getInstalledBuildId } from '../lib/steamcmd'
import { getGameVersion, getCachedGameVersion, setCachedGameVersion } from '../lib/serverVersion'

function requireProfile(profileId: string) {
  const profile = getProfile(profileId)
  if (!profile) throw new Error(`Unknown profile: ${profileId}`)
  return profile
}

export function registerServerProcessHandlers(webContents: WebContents): void {
  serverEvents.on('status', (status) => {
    if (!webContents.isDestroyed()) webContents.send(IPC.serverStatusChanged, status)
  })

  ipcMain.handle(IPC.serverStart, (_event, profileId: string) => doStartServer(requireProfile(profileId)))

  ipcMain.handle(IPC.serverStop, async (_event, profileId: string) => doStopServer(requireProfile(profileId)))

  ipcMain.handle(IPC.serverRestart, async (_event, profileId: string) => doRestartServer(requireProfile(profileId)))

  ipcMain.handle(IPC.serverKill, (_event, profileId: string) => {
    requireProfile(profileId)
    return doKillServer(profileId)
  })

  ipcMain.handle(IPC.serverUpdate, async (_event, profileId: string) => doUpdateServer(requireProfile(profileId)))

  ipcMain.handle(IPC.serverIsInstalled, (_event, profileId: string) => {
    const profile = requireProfile(profileId)
    return isValidArkInstall(profile.installDir)
  })

  ipcMain.handle(IPC.serverStatus, (_event, profileId: string) => getStatus(profileId))

  ipcMain.handle(IPC.serverGetInstalledBuildId, (_event, profileId: string) =>
    getInstalledBuildId(requireProfile(profileId).installDir)
  )

  ipcMain.handle(IPC.serverGetGameVersion, async (_event, profileId: string) => {
    const profile = requireProfile(profileId)
    const cached = getCachedGameVersion(profileId)
    if (cached) return cached

    const version = await getGameVersion(profile.installDir)
    if (version) setCachedGameVersion(profileId, version)
    return version
  })
}
