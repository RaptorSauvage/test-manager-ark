import type { BrowserWindow } from 'electron'
import { registerProfileHandlers } from './profiles'
import { registerServerProcessHandlers } from './serverProcess'
import { registerModsHandlers } from './mods'
import { registerBackupHandlers } from './backup'
import { registerPlayerBackupHandlers } from './playerBackup'
import { registerDialogHandlers } from './dialog'
import { registerSettingsHandlers } from './settings'
import { registerWebDashboardAccountsHandlers } from './webDashboardAccounts'
import { registerWebDashboardApiKeysHandlers } from './webDashboardApiKeys'
import { registerSteamcmdInstallHandlers } from './steamcmdInstall'
import { registerMapsHandlers } from './maps'
import { registerCustomMapsHandlers } from './customMaps'
import { registerDataDirHandlers } from './dataDir'
import { registerOfficialServerStatusHandlers } from './officialServerStatus'
import { registerSystemHandlers } from './system'
import { registerAppUpdateHandlers } from './appUpdate'
import { registerMapManagementHandlers } from './mapManagement'
import { registerGroupConsoleHandlers } from './groupConsole'

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  registerProfileHandlers()
  registerServerProcessHandlers(mainWindow.webContents)
  registerModsHandlers()
  registerBackupHandlers(mainWindow.webContents)
  registerPlayerBackupHandlers()
  registerDialogHandlers(mainWindow)
  registerSettingsHandlers()
  registerWebDashboardAccountsHandlers()
  registerWebDashboardApiKeysHandlers()
  registerSteamcmdInstallHandlers(mainWindow.webContents)
  registerMapsHandlers()
  registerCustomMapsHandlers()
  registerDataDirHandlers()
  registerOfficialServerStatusHandlers()
  registerSystemHandlers()
  registerAppUpdateHandlers(mainWindow.webContents)
  registerMapManagementHandlers()
  registerGroupConsoleHandlers(mainWindow.webContents)
}
