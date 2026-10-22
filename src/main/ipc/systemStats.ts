import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { getSystemStaticInfo } from '../lib/systemStats'

export function registerSystemStatsHandlers(): void {
  ipcMain.handle(IPC.systemStatsGet, () => getSystemStaticInfo())
}
