import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { getSettings, saveSettings } from '../store'
import { installManagedSteamCmd, getManagedSteamCmdStatus } from '../lib/steamcmdInstaller'

export function registerSteamcmdInstallHandlers(): void {
  ipcMain.handle(IPC.steamcmdManagedStatus, () => getManagedSteamCmdStatus())

  ipcMain.handle(IPC.steamcmdInstall, async () => {
    const exePath = await installManagedSteamCmd()
    saveSettings({ ...getSettings(), steamCmdPath: exePath })
    return exePath
  })
}
