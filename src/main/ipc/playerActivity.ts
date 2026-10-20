import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { listPlayerActivity, listPlayerSessions } from '../store'

export function registerPlayerActivityHandlers(): void {
  ipcMain.handle(IPC.playerActivityList, () => listPlayerActivity())
  ipcMain.handle(IPC.playerActivitySessions, () => listPlayerSessions())
}
