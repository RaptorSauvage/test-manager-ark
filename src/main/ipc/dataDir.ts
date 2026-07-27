import { ipcMain } from 'electron'
import { IPC } from '@shared/types'
import { getDefaultDataDir } from '../lib/dataDir'

export function registerDataDirHandlers(): void {
  ipcMain.handle(IPC.dataDirGetDefault, () => getDefaultDataDir())
}
