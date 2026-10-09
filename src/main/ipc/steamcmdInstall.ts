import { ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '@shared/types'
import type { GameId } from '@shared/games'
import { getSettings, saveSettings } from '../store'
import { installManagedSteamCmd, getManagedSteamCmdStatus } from '../lib/steamcmdInstaller'
import { readUpdateLog, steamcmdUpdateEvents } from '../lib/steamcmd'
import { addFirewallRulesForSteamCmd } from '../lib/firewall'
import { getLatestBuildIdCache } from '../lib/updateCheck'

export function registerSteamcmdInstallHandlers(mainWindow: BrowserWindow): void {
  const webContents = mainWindow.webContents
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

  ipcMain.handle(IPC.steamcmdAddFirewallRule, async (_event, steamCmdPath: string) => {
    // Start-Process -Verb RunAs (firewall.ts) pops a real native UAC prompt, same class of
    // OS-level modal as window.confirm()/the file pickers - Electron/Windows can fail to hand
    // keyboard focus back to the main window once it closes, silently freezing every text
    // field afterward until it's explicitly refocused (see system.ts's appFocusWindow doc
    // comment for the full story). Refocus here unconditionally, success or failure/
    // cancellation alike, the same way confirmAction() and dialog.ts's pickers already do.
    try {
      await addFirewallRulesForSteamCmd(steamCmdPath)
    } finally {
      if (!mainWindow.isDestroyed()) mainWindow.focus()
    }
  })

  ipcMain.handle(IPC.steamcmdLatestBuildId, (_event, game: GameId) => getLatestBuildIdCache(game))
}
