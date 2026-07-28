import { app, ipcMain, type WebContents } from 'electron'
import { IPC } from '@shared/types'
import { appUpdateEvents, checkForUpdateAndInstall, getAppUpdateStatus } from '../lib/appUpdater'

export function registerAppUpdateHandlers(webContents: WebContents): void {
  appUpdateEvents.on('status', (status) => {
    if (!webContents.isDestroyed()) webContents.send(IPC.appUpdateStatusChanged, status)
  })

  ipcMain.handle(IPC.appUpdateGetVersion, () => app.getVersion())
  ipcMain.handle(IPC.appUpdateCheckAndInstall, () => checkForUpdateAndInstall())
  ipcMain.handle(IPC.appUpdateStatus, () => getAppUpdateStatus())
}
