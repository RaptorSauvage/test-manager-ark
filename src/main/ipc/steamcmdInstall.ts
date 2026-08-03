import { ipcMain, type WebContents } from 'electron'
import { IPC } from '@shared/types'
import { getSettings, saveSettings } from '../store'
import { installManagedSteamCmd, getManagedSteamCmdStatus } from '../lib/steamcmdInstaller'
import { readUpdateLog, steamcmdUpdateEvents } from '../lib/steamcmd'
import { addFirewallRulesForSteamCmd } from '../lib/firewall'
import { getLatestBuildIdCache } from '../lib/updateCheck'

export function registerSteamcmdInstallHandlers(webContents: WebContents): void {
  steamcmdUpdateEvents.on('log', (profileId: string) => {
    if (!webContents.isDestroyed()) webContents.send(IPC.steamcmdUpdateLogChanged, profileId)
  })

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

  ipcMain.handle(IPC.steamcmdLatestBuildId, () => getLatestBuildIdCache())
}
