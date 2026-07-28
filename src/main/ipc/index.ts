import type { BrowserWindow } from 'electron'
import { registerProfileHandlers } from './profiles'
import { registerServerProcessHandlers } from './serverProcess'
import { registerModsHandlers } from './mods'
import { registerBackupHandlers } from './backup'
import { registerPlayerBackupHandlers } from './playerBackup'
import { registerDialogHandlers } from './dialog'
import { registerSettingsHandlers } from './settings'
import { registerSteamcmdInstallHandlers } from './steamcmdInstall'
import { registerMapsHandlers } from './maps'
import { registerCustomMapsHandlers } from './customMaps'
import { registerDataDirHandlers } from './dataDir'
import { registerOfficialServerStatusHandlers } from './officialServerStatus'
import { registerSystemHandlers } from './system'

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  registerProfileHandlers()
  registerServerProcessHandlers(mainWindow.webContents)
  registerModsHandlers()
  registerBackupHandlers(mainWindow.webContents)
  registerPlayerBackupHandlers()
  registerDialogHandlers(mainWindow)
  registerSettingsHandlers()
  registerSteamcmdInstallHandlers()
  registerMapsHandlers()
  registerCustomMapsHandlers()
  registerDataDirHandlers()
  registerOfficialServerStatusHandlers()
  registerSystemHandlers()
}
