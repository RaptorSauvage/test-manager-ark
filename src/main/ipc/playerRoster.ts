import { ipcMain } from 'electron'
import { IPC, type ServerProfile } from '@shared/types'
import { getProfile } from '../store'
import { sendRconCommand, parsePlayerListWithIds } from '../lib/rcon'

function requireProfile(profileId: string): ServerProfile {
  const profile = getProfile(profileId)
  if (!profile) throw new Error(`Unknown profile: ${profileId}`)
  return profile
}

/** Desktop mirror of the web dashboard's own GET .../players and Kick context-menu action
 *  (ARK only, same as playerBans.ts/playerActivity.ts). */
export function registerPlayerRosterHandlers(): void {
  ipcMain.handle(IPC.playerRosterList, async (_event, profileId: string) => {
    const profile = requireProfile(profileId)
    const result = await sendRconCommand(profile, 'ListPlayers')
    return result.ok && result.response ? parsePlayerListWithIds(result.response) : []
  })

  ipcMain.handle(IPC.playerRosterKick, async (_event, profileId: string, playerId: string) => {
    const profile = requireProfile(profileId)
    const result = await sendRconCommand(profile, `KickPlayer ${playerId}`)
    if (!result.ok) throw new Error(result.error ?? 'KickPlayer failed')
  })
}
