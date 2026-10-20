import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { listWatchedPlayers, addWatchedPlayer, removeWatchedPlayer } from '../store'

export function registerWatchedPlayersHandlers(): void {
  ipcMain.handle(IPC.watchedPlayersList, () => listWatchedPlayers())

  ipcMain.handle(IPC.watchedPlayersAdd, (_event, value: string, label: string) =>
    addWatchedPlayer({ id: randomUUID(), value, label, createdAt: Date.now() })
  )

  ipcMain.handle(IPC.watchedPlayersRemove, (_event, id: string) => removeWatchedPlayer(id))
}
