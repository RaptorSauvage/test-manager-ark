import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { getDiscordBotStatus, restartDiscordBot } from '../lib/discordBot'

export function registerDiscordBotHandlers(): void {
  ipcMain.handle(IPC.discordBotStatus, () => getDiscordBotStatus())
  ipcMain.handle(IPC.discordBotRestart, async () => {
    await restartDiscordBot()
    return getDiscordBotStatus()
  })
}
