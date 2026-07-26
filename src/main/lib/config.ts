import fs from 'node:fs'
import path from 'node:path'
import ini from 'ini'
import type { ServerProfile, ServerConfigSummary, RawIniFiles, ServerMod } from '@shared/types'

/**
 * ARK:SA writes its dedicated-server config under a WindowsServer folder even
 * on most Linux installs. If a LinuxServer folder exists instead (some
 * community builds), prefer it.
 */
export function resolveConfigDir(installDir: string): string {
  const winDir = path.join(installDir, 'ShooterGame', 'Saved', 'Config', 'WindowsServer')
  const linuxDir = path.join(installDir, 'ShooterGame', 'Saved', 'Config', 'LinuxServer')
  if (!fs.existsSync(winDir) && fs.existsSync(linuxDir)) return linuxDir
  return winDir
}

function configDir(profile: ServerProfile): string {
  return resolveConfigDir(profile.installDir)
}

function gameUserSettingsPath(profile: ServerProfile): string {
  return path.join(configDir(profile), 'GameUserSettings.ini')
}

function gameIniPath(profile: ServerProfile): string {
  return path.join(configDir(profile), 'Game.ini')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IniData = Record<string, any>

export function readIniFile(filePath: string): IniData {
  if (!fs.existsSync(filePath)) return {}
  return ini.parse(fs.readFileSync(filePath, 'utf-8'))
}

function writeIniFile(filePath: string, data: IniData): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, ini.stringify(data))
}

export function readConfigSummary(profile: ServerProfile): ServerConfigSummary {
  const gus = readIniFile(gameUserSettingsPath(profile))
  const serverSettings = gus.ServerSettings ?? {}
  const sessionSettings = gus.SessionSettings ?? {}

  return {
    sessionName: sessionSettings.SessionName ?? '',
    serverPassword: serverSettings.ServerPassword ?? '',
    serverAdminPassword: serverSettings.ServerAdminPassword ?? '',
    maxPlayers: Number(sessionSettings.MaxPlayers ?? 70),
    difficultyOffset: Number(serverSettings.DifficultyOffset ?? 1),
    xpMultiplier: Number(serverSettings.XPMultiplier ?? 1),
    tamingSpeedMultiplier: Number(serverSettings.TamingSpeedMultiplier ?? 1),
    harvestAmountMultiplier: Number(serverSettings.HarvestAmountMultiplier ?? 1),
    pve: String(serverSettings.ServerPVE ?? 'False').toLowerCase() === 'true'
  }
}

export function writeConfigSummary(profile: ServerProfile, summary: ServerConfigSummary): void {
  const filePath = gameUserSettingsPath(profile)
  const gus = readIniFile(filePath)
  gus.ServerSettings = gus.ServerSettings ?? {}
  gus.SessionSettings = gus.SessionSettings ?? {}

  gus.SessionSettings.SessionName = summary.sessionName
  gus.SessionSettings.MaxPlayers = summary.maxPlayers
  gus.ServerSettings.ServerPassword = summary.serverPassword
  gus.ServerSettings.ServerAdminPassword = summary.serverAdminPassword
  gus.ServerSettings.DifficultyOffset = summary.difficultyOffset
  gus.ServerSettings.XPMultiplier = summary.xpMultiplier
  gus.ServerSettings.TamingSpeedMultiplier = summary.tamingSpeedMultiplier
  gus.ServerSettings.HarvestAmountMultiplier = summary.harvestAmountMultiplier
  gus.ServerSettings.ServerPVE = summary.pve

  writeIniFile(filePath, gus)
}

export function readRawIniFiles(profile: ServerProfile): RawIniFiles {
  const gusPath = gameUserSettingsPath(profile)
  const gPath = gameIniPath(profile)
  return {
    gameUserSettings: fs.existsSync(gusPath) ? fs.readFileSync(gusPath, 'utf-8') : '',
    game: fs.existsSync(gPath) ? fs.readFileSync(gPath, 'utf-8') : ''
  }
}

export function writeRawIniFiles(profile: ServerProfile, files: RawIniFiles): void {
  const gusPath = gameUserSettingsPath(profile)
  const gPath = gameIniPath(profile)
  fs.mkdirSync(path.dirname(gusPath), { recursive: true })
  fs.writeFileSync(gusPath, files.gameUserSettings)
  fs.writeFileSync(gPath, files.game)
}

/** Writes only the enabled mod IDs to ActiveMods; disabled ones are kept in the profile but not in the ini. */
export function saveMods(profile: ServerProfile, mods: ServerMod[]): void {
  const filePath = gameUserSettingsPath(profile)
  const gus = readIniFile(filePath)
  gus.ServerSettings = gus.ServerSettings ?? {}
  gus.ServerSettings.ActiveMods = mods
    .filter((mod) => mod.enabled)
    .map((mod) => mod.id)
    .join(',')
  writeIniFile(filePath, gus)
}
