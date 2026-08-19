import { ipcMain, type WebContents } from 'electron'
import { IPC, type ServerProfile } from '@shared/types'
import { getProfile } from '../store'
import { getGroupConsoleBacklog, watchGroupConsole } from '../lib/groupConsole'

/** Only one Group Console page is ever open at a time in this single-window app - a new
 *  subscribe call replaces whatever was previously active instead of stacking tailers. */
let stopWatching: (() => void) | null = null

export function registerGroupConsoleHandlers(webContents: WebContents): void {
  ipcMain.handle(IPC.groupConsoleSubscribe, (_event, profileIds: string[]) => {
    stopWatching?.()
    const profiles = profileIds
      .map((id) => getProfile(id))
      .filter((p): p is ServerProfile => p !== undefined)
    stopWatching = watchGroupConsole(profiles, (event) => {
      if (!webContents.isDestroyed()) webContents.send(IPC.groupConsoleEvent, event)
    })
    return getGroupConsoleBacklog(profiles)
  })

  ipcMain.handle(IPC.groupConsoleUnsubscribe, () => {
    stopWatching?.()
    stopWatching = null
  })
}
