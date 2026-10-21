import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { listWhitelistedPlayers, recordWhitelistedPlayer, removeWhitelistedPlayerProfile } from '../store'

/** Tracking-only, unlike playerBans.ts - no RCON call, see WhitelistedPlayer's own doc
 *  comment (shared/types.ts) for why. */
export function registerPlayerWhitelistHandlers(): void {
  ipcMain.handle(IPC.playerWhitelistList, () => listWhitelistedPlayers())

  ipcMain.handle(IPC.playerWhitelistAdd, (_event, profileId: string, playerId: string, playerName: string) =>
    recordWhitelistedPlayer(playerId, playerName, profileId)
  )

  ipcMain.handle(IPC.playerWhitelistRemove, (_event, profileId: string, playerId: string) =>
    removeWhitelistedPlayerProfile(playerId, profileId)
  )
}
