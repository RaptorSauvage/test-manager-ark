import type { WebContents } from 'electron'
import { registerProfileHandlers } from './profiles'
import { registerServerProcessHandlers } from './serverProcess'
import { registerRconHandlers } from './rcon'
import { registerConfigHandlers } from './config'
import { registerBackupHandlers } from './backup'

export function registerIpcHandlers(webContents: WebContents): void {
  registerProfileHandlers()
  registerServerProcessHandlers(webContents)
  registerRconHandlers()
  registerConfigHandlers()
  registerBackupHandlers()
}
