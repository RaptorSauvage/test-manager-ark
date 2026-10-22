import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { getSystemStaticInfo, getNetworkUsage } from '../lib/systemStats'

export function registerSystemStatsHandlers(): void {
  ipcMain.handle(IPC.systemStatsGet, () => getSystemStaticInfo())
  ipcMain.handle(IPC.systemStatsGetNetworkUsage, () => getNetworkUsage())
}
