import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { searchArkMods, getArkModsInfo } from '../lib/arkMods'

export function registerArkModsHandlers(): void {
  ipcMain.handle(IPC.arkModsSearch, (_event, query: string) => searchArkMods(query))
  ipcMain.handle(IPC.arkModsInfo, (_event, modIds: string[]) => getArkModsInfo(modIds))
}
