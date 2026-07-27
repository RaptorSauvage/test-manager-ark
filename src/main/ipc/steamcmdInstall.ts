import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { getSettings, saveSettings } from '../store'
import { installManagedSteamCmd, getManagedSteamCmdStatus } from '../lib/steamcmdInstaller'
import { readUpdateLog } from '../lib/steamcmd'
import { addFirewallRulesForSteamCmd } from '../lib/firewall'

export function registerSteamcmdInstallHandlers(): void {
  ipcMain.handle(IPC.steamcmdManagedStatus, () => getManagedSteamCmdStatus())

  ipcMain.handle(IPC.steamcmdInstall, async () => {
    const exePath = await installManagedSteamCmd()
    saveSettings({ ...getSettings(), steamCmdPath: exePath })
    return exePath
  })

  ipcMain.handle(IPC.steamcmdUpdateLog, (_event, profileId: string) => readUpdateLog(profileId))

  ipcMain.handle(IPC.steamcmdAddFirewallRule, (_event, steamCmdPath: string) =>
    addFirewallRulesForSteamCmd(steamCmdPath)
  )
}
