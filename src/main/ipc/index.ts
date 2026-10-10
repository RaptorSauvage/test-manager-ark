import type { BrowserWindow } from 'electron'
import { registerProfileHandlers } from './profiles'
import { registerServerProcessHandlers } from './serverProcess'
import { registerModsHandlers } from './mods'
import { registerBackupHandlers } from './backup'
import { registerPlayerBackupHandlers } from './playerBackup'
import { registerDialogHandlers } from './dialog'
import { registerArkModsHandlers } from './arkMods'
import { registerSettingsHandlers } from './settings'
import { registerWebDashboardAccessTokensHandlers } from './webDashboardAccessTokens'
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
import { registerManagerLogHandlers } from './managerLog'
import { registerStatsHistoryHandlers } from './statsHistory'
import { registerMinecraftHandlers } from './minecraft'
import { registerMinecraftBackupHandlers } from './minecraftBackup'
import { registerMinecraftModsHandlers } from './minecraftMods'
import { registerMinecraftInstallHandlers } from './minecraftInstall'

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  registerProfileHandlers(mainWindow.webContents)
  registerServerProcessHandlers(mainWindow.webContents)
  registerModsHandlers()
  registerArkModsHandlers()
  registerBackupHandlers(mainWindow.webContents)
  registerPlayerBackupHandlers()
  registerDialogHandlers(mainWindow)
  registerSettingsHandlers()
  registerWebDashboardAccessTokensHandlers()
  registerWebDashboardApiKeysHandlers()
  registerSteamcmdInstallHandlers(mainWindow)
  registerMapsHandlers()
  registerCustomMapsHandlers()
  registerDataDirHandlers()
  registerOfficialServerStatusHandlers()
  registerSystemHandlers(mainWindow)
  registerAppUpdateHandlers(mainWindow.webContents)
  registerMapManagementHandlers()
  registerGroupConsoleHandlers(mainWindow.webContents)
  registerManagerLogHandlers(mainWindow.webContents)
  registerStatsHistoryHandlers()
  registerMinecraftHandlers(mainWindow.webContents)
  registerMinecraftBackupHandlers(mainWindow.webContents)
  registerMinecraftModsHandlers()
  registerMinecraftInstallHandlers()
}
