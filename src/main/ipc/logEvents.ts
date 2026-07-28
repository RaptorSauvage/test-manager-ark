import { ipcMain, type WebContents } from 'electron'
import { IPC, type LogEvent } from '@shared/types'
import { getRecentLogEvents, logEventEmitter } from '../lib/logEvents'

export function registerLogEventHandlers(webContents: WebContents): void {
  logEventEmitter.on('event', (profileId: string, event: LogEvent) => {
    if (!webContents.isDestroyed()) webContents.send(IPC.serverLogEvent, profileId, event)
  })

  ipcMain.handle(IPC.serverLogEventsList, (_event, profileId: string) => getRecentLogEvents(profileId))
}
