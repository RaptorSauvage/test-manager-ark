import { ipcMain } from 'electron'
import { IPC, type ServerProfile } from '@shared/types'
import { getProfile, listPlayerBans, recordPlayerBan, removePlayerBanProfile } from '../store'
import { sendRconCommand } from '../lib/rcon'

function requireProfile(profileId: string): ServerProfile {
  const profile = getProfile(profileId)
  if (!profile) throw new Error(`Unknown profile: ${profileId}`)
  return profile
}

export function registerPlayerBansHandlers(): void {
  ipcMain.handle(IPC.playerBansList, () => listPlayerBans())

  ipcMain.handle(IPC.playerBansBan, async (_event, profileId: string, playerId: string, playerName: string, reason: string) => {
    const profile = requireProfile(profileId)
    const result = await sendRconCommand(profile, `BanPlayer ${playerId}`)
    if (!result.ok) throw new Error(result.error ?? 'BanPlayer failed')
    return recordPlayerBan(playerId, playerName, reason, profileId)
  })

  ipcMain.handle(IPC.playerBansUnban, async (_event, profileId: string, playerId: string) => {
    const profile = requireProfile(profileId)
    const result = await sendRconCommand(profile, `UnbanPlayer ${playerId}`)
    if (!result.ok) throw new Error(result.error ?? 'UnbanPlayer failed')
    return removePlayerBanProfile(playerId, profileId)
  })
}
