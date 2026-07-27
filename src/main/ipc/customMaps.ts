import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { listCustomMaps } from '../lib/customMaps'

export function registerCustomMapsHandlers(): void {
  ipcMain.handle(IPC.customMapsList, () => listCustomMaps())
}
