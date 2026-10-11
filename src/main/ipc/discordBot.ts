import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { getDiscordBotStatus, restartDiscordBot, stopDiscordBot } from '../lib/discordBot'

export function registerDiscordBotHandlers(): void {
  ipcMain.handle(IPC.discordBotStatus, () => getDiscordBotStatus())
  ipcMain.handle(IPC.discordBotRestart, async () => {
    await restartDiscordBot()
    return getDiscordBotStatus()
  })
  // Stops the bot process without touching discordBotEnabled - a manual, immediate "turn
  // it off" independent of the Settings checkbox, which only takes effect on the next Save.
  // The next Settings save (or Manager restart) still respawns it if the checkbox is still
  // on - this is a one-shot stop, not a persisted "disabled until re-enabled" state.
  ipcMain.handle(IPC.discordBotStop, () => {
    stopDiscordBot()
    return getDiscordBotStatus()
  })
}
