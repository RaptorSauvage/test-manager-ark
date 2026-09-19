import { ipcMain, type WebContents } from 'electron'
import { IPC, type ManagerLogEntry } from '@shared/types'
import { readManagerLog, managerLogEvents } from '../lib/managerLog'

export function registerManagerLogHandlers(webContents: WebContents): void {
  managerLogEvents.on('log', (entry: ManagerLogEntry) => {
    if (!webContents.isDestroyed()) webContents.send(IPC.managerLogChanged, entry)
  })

  ipcMain.handle(IPC.managerLogGet, () => readManagerLog())
}
