import { ipcMain, type WebContents } from 'electron'
import { IPC } from '@shared/types'
import { getProfile } from '../store'
import { startServer, stopServer, restartServer, getStatus, serverEvents } from '../lib/serverProcess'
import { startMonitoring, stopMonitoring } from '../lib/monitor'

function requireProfile(profileId: string) {
  const profile = getProfile(profileId)
  if (!profile) throw new Error(`Unknown profile: ${profileId}`)
  return profile
}

export function registerServerProcessHandlers(webContents: WebContents): void {
  serverEvents.on('status', (status) => {
    if (!webContents.isDestroyed()) webContents.send(IPC.serverStatusChanged, status)
  })
  serverEvents.on('log', (line) => {
    if (!webContents.isDestroyed()) webContents.send(IPC.serverLogLine, line)
  })

  ipcMain.handle(IPC.serverStart, (_event, profileId: string) => {
    const profile = requireProfile(profileId)
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

  ipcMain.handle(IPC.serverStatus, (_event, profileId: string) => getStatus(profileId))
}
