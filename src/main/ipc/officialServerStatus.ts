import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { fetchOfficialServerStatus } from '../lib/officialServerStatus'

export function registerOfficialServerStatusHandlers(): void {
  ipcMain.handle(IPC.officialServerStatusGet, () => fetchOfficialServerStatus())
}
