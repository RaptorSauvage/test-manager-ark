import { ipcMain } from 'electron'
import { IPC, type AppSettings } from '@shared/types'
import { getSettings, saveSettings } from '../store'
import { applyWebDashboardSettings, getWebDashboardStatus, getLocalNetworkIps } from '../lib/webDashboard'
import { applyLaunchOnStartup } from '../lib/launchOnStartup'

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsSave, (_event, settings: AppSettings) => {
    const saved = saveSettings(settings)
    applyWebDashboardSettings(saved)
    applyLaunchOnStartup(saved)
    return saved
  })
  ipcMain.handle(IPC.webDashboardStatus, () => getWebDashboardStatus())
  ipcMain.handle(IPC.webDashboardLocalIps, () => getLocalNetworkIps())
}
