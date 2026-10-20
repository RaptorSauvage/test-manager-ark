import { ipcMain } from 'electron'
import { IPC, type AppSettings } from '@shared/types'
import { getSettings, saveSettings, listProfiles } from '../store'
import { applyWebDashboardSettings, getWebDashboardStatus, getLocalNetworkIps } from '../lib/webDashboard'
import { applyDiscordBotSettings } from '../lib/discordBot'
import { applyLaunchOnStartup } from '../lib/launchOnStartup'
import { applyIniLockSetting } from '../lib/iniLock'
import { syncAllPlayerJoinAlertWatches } from '../lib/playerJoinAlertWatch'
import { syncAllPlayerActivityWatches } from '../lib/playerActivityWatch'

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsSave, async (_event, settings: AppSettings) => {
    const saved = saveSettings(settings)
    applyWebDashboardSettings(saved)
    await applyDiscordBotSettings(saved)
    applyLaunchOnStartup(saved)
    applyIniLockSetting(saved.iniLockEnabled, listProfiles())
    syncAllPlayerJoinAlertWatches()
    syncAllPlayerActivityWatches()
    return saved
  })
  ipcMain.handle(IPC.webDashboardStatus, () => getWebDashboardStatus())
  ipcMain.handle(IPC.webDashboardLocalIps, () => getLocalNetworkIps())
}
