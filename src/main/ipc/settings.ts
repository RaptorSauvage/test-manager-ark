import { ipcMain } from 'electron'
import { IPC, type AppSettings } from '@shared/types'
import { getSettings, saveSettings, listProfiles } from '../store'
import { applyWebDashboardSettings, getWebDashboardStatus, getLocalNetworkIps } from '../lib/webDashboard'
import { applyLaunchOnStartup } from '../lib/launchOnStartup'
import { applyIniLockSetting } from '../lib/iniLock'

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsSave, (_event, settings: AppSettings) => {
    const saved = saveSettings(settings)
    applyWebDashboardSettings(saved)
    applyLaunchOnStartup(saved)
    applyIniLockSetting(saved.iniLockEnabled, listProfiles())
    return saved
  })
  ipcMain.handle(IPC.webDashboardStatus, () => getWebDashboardStatus())
  ipcMain.handle(IPC.webDashboardLocalIps, () => getLocalNetworkIps())
}
