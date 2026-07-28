import fs from 'node:fs'
import path from 'node:path'
import { app, shell } from 'electron'
import type { ServerProfile } from '@shared/types'

/** Where electron-store persists profiles/settings (a single config.json), since no `cwd`
 *  override is passed to the Store constructor - this is electron-store's own default. */
export function getProfilesStoreDir(): string {
  return app.getPath('userData')
}

export async function openProfilesFolder(): Promise<void> {
  const error = await shell.openPath(getProfilesStoreDir())
  if (error) throw new Error(error)
}

/** Where ARK writes GameUserSettings.ini/Game.ini for a given install. */
export function getServerConfigDir(installDir: string): string {
  return path.join(installDir, 'ShooterGame', 'Saved', 'Config', 'WindowsServer')
}

export async function openServerConfigFolder(profile: ServerProfile): Promise<void> {
  const dir = getServerConfigDir(profile.installDir)
  if (!fs.existsSync(dir)) {
    throw new Error('No config folder yet - install/run this server at least once first.')
  }
  const error = await shell.openPath(dir)
  if (error) throw new Error(error)
}
