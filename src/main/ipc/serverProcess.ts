import { ipcMain, type WebContents } from 'electron'
import { IPC } from '@shared/types'
import { getProfile, getSettings } from '../store'
import {
  startServer,
  stopServer,
  restartServer,
  killServer,
  getStatus,
  isUpdating,
  serverEvents
} from '../lib/serverProcess'
import { startMonitoring, stopMonitoring } from '../lib/monitor'
import { updateServer } from '../lib/steamcmd'
import { isValidArkInstall } from '../lib/detect'

function requireProfile(profileId: string) {
  const profile = getProfile(profileId)
  if (!profile) throw new Error(`Unknown profile: ${profileId}`)
  return profile
}

export function registerServerProcessHandlers(webContents: WebContents): void {
  serverEvents.on('status', (status) => {
    if (!webContents.isDestroyed()) webContents.send(IPC.serverStatusChanged, status)
  })

  ipcMain.handle(IPC.serverStart, (_event, profileId: string) => {
    const profile = requireProfile(profileId)
    if (isUpdating(profileId)) throw new Error('Cannot start the server while an update is in progress.')
    const status = startServer(profile)
    startMonitoring(profile)
    return status
  })

  ipcMain.handle(IPC.serverStop, async (_event, profileId: string) => {
    const profile = requireProfile(profileId)
    stopMonitoring(profileId)
    return stopServer(profile)
  })

  ipcMain.handle(IPC.serverRestart, async (_event, profileId: string) => {
    const profile = requireProfile(profileId)
    const status = await restartServer(profile)
    startMonitoring(profile)
    return status
  })

  ipcMain.handle(IPC.serverKill, (_event, profileId: string) => {
    requireProfile(profileId)
    stopMonitoring(profileId)
    return killServer(profileId)
  })

  ipcMain.handle(IPC.serverUpdate, async (_event, profileId: string) => {
    const profile = requireProfile(profileId)
    const settings = getSettings()
    await updateServer(profile, settings.steamCmdPath)
  })

  ipcMain.handle(IPC.serverIsInstalled, (_event, profileId: string) => {
    const profile = requireProfile(profileId)
    return isValidArkInstall(profile.installDir)
  })

  ipcMain.handle(IPC.serverStatus, (_event, profileId: string) => getStatus(profileId))
}
