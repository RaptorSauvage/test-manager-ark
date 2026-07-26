import { ipcMain } from 'electron'
import { IPC, type AppSettings } from '@shared/types'
import { getSettings, saveSettings } from '../store'

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsSave, (_event, settings: AppSettings) => saveSettings(settings))
}
