import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import type { GameId } from '@shared/games'
import { listMaps } from '../lib/maps'

export function registerMapsHandlers(): void {
  ipcMain.handle(IPC.mapsList, (_event, game: GameId) => listMaps(game))
}
