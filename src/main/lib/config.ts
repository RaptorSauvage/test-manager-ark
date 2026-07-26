import fs from 'node:fs'
import path from 'node:path'
import ini from 'ini'

/**
 * ARK:SA writes its dedicated-server config under a WindowsServer folder even
 * on most Linux installs. If a LinuxServer folder exists instead (some
 * community builds), prefer it.
 *
 * The app only reads this file, as a best-effort hint when importing an
 * existing install (session name, RCON password) - it never writes to it.
 * Users manage GameUserSettings.ini/Game.ini themselves.
 */
export function resolveConfigDir(installDir: string): string {
  const winDir = path.join(installDir, 'ShooterGame', 'Saved', 'Config', 'WindowsServer')
  const linuxDir = path.join(installDir, 'ShooterGame', 'Saved', 'Config', 'LinuxServer')
  if (!fs.existsSync(winDir) && fs.existsSync(linuxDir)) return linuxDir
  return winDir
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IniData = Record<string, any>

export function readIniFile(filePath: string): IniData {
  if (!fs.existsSync(filePath)) return {}
  return ini.parse(fs.readFileSync(filePath, 'utf-8'))
}

/**
 * Reads ServerAdminPassword straight from GameUserSettings.ini - this is also
 * the RCON password, and the user manages this file themselves, so the app
 * always reads it fresh instead of asking for/storing its own copy.
 */
export function readAdminPassword(installDir: string): string {
  const gus = readIniFile(path.join(resolveConfigDir(installDir), 'GameUserSettings.ini'))
  return gus.ServerSettings?.ServerAdminPassword ?? ''
}
