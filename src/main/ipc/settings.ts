import { ipcMain } from 'electron'
import { IPC, type AppSettings } from '@shared/types'
import { getSettings, saveSettings } from '../store'
import { applyWebDashboardSettings, getWebDashboardStatus } from '../lib/webDashboard'

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsSave, (_event, settings: AppSettings) => {
    const saved = saveSettings(settings)
    applyWebDashboardSettings(saved)
    return saved
  })
  ipcMain.handle(IPC.webDashboardStatus, () => getWebDashboardStatus())
}
