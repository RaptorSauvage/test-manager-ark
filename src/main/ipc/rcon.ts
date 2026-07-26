import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { getProfile } from '../store'
import { sendRconCommand } from '../lib/rcon'

export function registerRconHandlers(): void {
  ipcMain.handle(IPC.rconSend, async (_event, profileId: string, command: string) => {
    const profile = getProfile(profileId)
    if (!profile) throw new Error(`Unknown profile: ${profileId}`)
    return sendRconCommand(profile, command)
  })
}
