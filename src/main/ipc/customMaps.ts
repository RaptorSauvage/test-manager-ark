import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { listCustomMaps, addCustomMap, updateCustomMap, deleteCustomMap } from '../lib/customMaps'

export function registerCustomMapsHandlers(): void {
  ipcMain.handle(IPC.customMapsList, () => listCustomMaps())
  ipcMain.handle(IPC.customMapsAdd, (_e, entry) => addCustomMap(entry))
  ipcMain.handle(IPC.customMapsUpdate, (_e, originalId, entry) => updateCustomMap(originalId, entry))
  ipcMain.handle(IPC.customMapsDelete, (_e, id) => deleteCustomMap(id))
}
