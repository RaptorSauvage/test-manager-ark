import fs from 'node:fs'
import path from 'node:path'
import { resolveConfigDir } from './config'

/** Used by the "Create New Server" wizard's "copy configuration from an existing server"
 *  path - after a fresh install finishes, best-effort copy GameUserSettings.ini/Game.ini
 *  over from another profile's install so the new server starts with the same settings
 *  instead of ARK's own defaults. A missing source file isn't an error - that profile
 *  hasn't had anything configured there either. */
export function copyProfileConfigFiles(sourceInstallDir: string, destInstallDir: string): void {
  const sourceDir = resolveConfigDir(sourceInstallDir)
  const destDir = resolveConfigDir(destInstallDir)
  fs.mkdirSync(destDir, { recursive: true })
  for (const fileName of ['GameUserSettings.ini', 'Game.ini']) {
    try {
      fs.copyFileSync(path.join(sourceDir, fileName), path.join(destDir, fileName))
    } catch {
      // Best-effort - see above.
    }
  }
}
