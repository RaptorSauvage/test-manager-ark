import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { getSystemStats } from '../lib/systemStats'

export function registerSystemStatsHandlers(): void {
  ipcMain.handle(IPC.systemStatsGet, () => getSystemStats())
}
