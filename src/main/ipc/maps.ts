import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { listMaps } from '../lib/maps'

export function registerMapsHandlers(): void {
  ipcMain.handle(IPC.mapsList, () => listMaps())
}
