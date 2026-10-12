import fs from 'node:fs'
import path from 'node:path'
import ini from 'ini'

/**
 * ARK:SA writes its dedicated-server config under a WindowsServer folder even
 * on most Linux installs. If a LinuxServer folder exists instead (some
 * community builds), prefer it.
 *
 * This module (config.ts) only reads these files, as a best-effort hint when importing an
 * existing install (session name, RCON password) - it never writes to them. Users manage
 * GameUserSettings.ini/Game.ini themselves - except for ARK: Survival Evolved's mods, which
 * have no other mechanism (see gameConfigWrite.ts, called from ipc/mods.ts).
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
  try {
    // A leading UTF-8 BOM (common after the file's been saved/re-saved by Notepad or some
    // server panels on Windows) breaks the ini package's section-header parsing -
    // `[Section]` with a BOM in front reads as a literal `"[Section]": true` key instead of
    // a section, silently making everything under it (including ServerAdminPassword)
    // unreadable even though it's right there in the file.
    const BOM = String.fromCharCode(0xfeff)
    const raw = fs.readFileSync(filePath, 'utf-8')
    const content = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw
    return ini.parse(content)
  } catch (err) {
    // readAdminPassword (below) is called from buildLaunchArgs on every single server start
    // - a disk-level read failure here must not crash the start itself. A real report on
    // Windows showed exactly that: 'server:start' throwing straight out of readIniFile,
    // meaning a server couldn't even be started while its disk was having trouble. Treated
    // the same as the file not existing (an empty GameUserSettings.ini/Game.ini) - the
    // worse-case fallout is a launch missing ServerAdminPassword= (RCON won't authenticate
    // until the next successful read), which is recoverable; not being able to start the
    // server at all isn't.
    console.error(`Failed to read ${filePath}:`, (err as Error).message)
    return {}
  }
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
