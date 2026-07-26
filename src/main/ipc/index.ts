import type { BrowserWindow } from 'electron'
import { registerProfileHandlers } from './profiles'
import { registerServerProcessHandlers } from './serverProcess'
import { registerRconHandlers } from './rcon'
import { registerModsHandlers } from './mods'
import { registerBackupHandlers } from './backup'
import { registerDialogHandlers } from './dialog'
import { registerSettingsHandlers } from './settings'

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  registerProfileHandlers()
  registerServerProcessHandlers(mainWindow.webContents)
  registerRconHandlers()
  registerModsHandlers()
  registerBackupHandlers()
  registerDialogHandlers(mainWindow)
  registerSettingsHandlers()
}
