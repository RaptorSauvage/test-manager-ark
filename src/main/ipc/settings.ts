import { ipcMain } from 'electron'
import { IPC, type AppSettings } from '@shared/types'
import { getSettings, saveSettings, listProfiles } from '../store'
import { applyWebDashboardSettings, getWebDashboardStatus, getLocalNetworkIps } from '../lib/webDashboard'
import { applyDiscordBotSettings } from '../lib/discordBot'
import { applyLaunchOnStartup } from '../lib/launchOnStartup'
import { applyIniLockSetting } from '../lib/iniLock'

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsSave, async (_event, settings: AppSettings) => {
    console.log('[DIAG] settingsSave received closeToTrayEnabled:', settings.closeToTrayEnabled)
    const saved = saveSettings(settings)
    console.log('[DIAG] settingsSave persisted closeToTrayEnabled:', saved.closeToTrayEnabled, '- readback:', getSettings().closeToTrayEnabled)
    applyWebDashboardSettings(saved)
    await applyDiscordBotSettings(saved)
    applyLaunchOnStartup(saved)
    applyIniLockSetting(saved.iniLockEnabled, listProfiles())
    return saved
  })
  ipcMain.handle(IPC.webDashboardStatus, () => getWebDashboardStatus())
  ipcMain.handle(IPC.webDashboardLocalIps, () => getLocalNetworkIps())
}
