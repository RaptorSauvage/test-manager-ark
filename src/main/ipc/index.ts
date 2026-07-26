import type { BrowserWindow } from 'electron'
import { registerProfileHandlers } from './profiles'
import { registerServerProcessHandlers } from './serverProcess'
import { registerRconHandlers } from './rcon'
import { registerConfigHandlers } from './config'
import { registerBackupHandlers } from './backup'
import { registerDialogHandlers } from './dialog'

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  registerProfileHandlers()
  registerServerProcessHandlers(mainWindow.webContents)
  registerRconHandlers()
  registerConfigHandlers()
  registerBackupHandlers()
  registerDialogHandlers(mainWindow)
}
