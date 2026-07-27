import path from 'node:path'
import { app } from 'electron'
import { getSettings } from '../store'

/** Default base folder for editable JSON config files, used when the user hasn't set one. */
export function getDefaultDataDir(): string {
  return path.join(app.getPath('documents'), 'ARK Server Manager')
}

/** The effective data directory: the user's configured folder, or the default if unset. */
export function getDataDir(): string {
  const configured = getSettings().dataDir?.trim()
  return configured ? configured : getDefaultDataDir()
}
