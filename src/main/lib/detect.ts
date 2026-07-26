import fs from 'node:fs'
import path from 'node:path'
import type { ServerMod } from '@shared/types'
import { resolveConfigDir, readIniFile } from './config'

export interface DetectedProfileFields {
  suggestedName: string
  map: string
  rconPassword: string
  mods: ServerMod[]
  gamePort?: number
  queryPort?: number
  rconPort?: number
}

function executableCandidates(installDir: string): string[] {
  return [
    path.join(installDir, 'ShooterGame', 'Binaries', 'Win64', 'ArkAscendedServer.exe'),
    path.join(installDir, 'ShooterGame', 'Binaries', 'Linux', 'ArkAscendedServer')
  ]
}

export function isValidArkInstall(installDir: string): boolean {
  return executableCandidates(installDir).some((candidate) => fs.existsSync(candidate))
}

/** Best-effort: the map is whichever subfolder exists under SavedArks (usually just one). */
function detectMap(installDir: string): string {
  const savedArksDir = path.join(installDir, 'ShooterGame', 'Saved', 'SavedArks')
  if (!fs.existsSync(savedArksDir)) return ''
  const mapDir = fs
    .readdirSync(savedArksDir, { withFileTypes: true })
    .find((entry) => entry.isDirectory())
  return mapDir?.name ?? ''
}

function parsePort(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * Scans an existing ARK:SA install folder and pulls out whatever it can from
 * GameUserSettings.ini. Ports and mods aren't actually used from this file by
 * the game (ports are launch-flag only, mods load via -mods=), so an
 * ActiveMods entry here would only exist if another tool wrote it - treat
 * anything detected as a starting guess, not a source of truth.
 */
export function detectProfileFields(installDir: string): DetectedProfileFields {
  const configDir = resolveConfigDir(installDir)
  const gus = readIniFile(path.join(configDir, 'GameUserSettings.ini'))
  const serverSettings = gus.ServerSettings ?? {}
  const sessionSettings = gus.SessionSettings ?? {}

  const mods: ServerMod[] = String(serverSettings.ActiveMods ?? '')
    .split(',')
    .map((id: string) => id.trim())
    .filter(Boolean)
    .map((id: string) => ({ id, enabled: true, dev: false }))

  return {
    suggestedName: sessionSettings.SessionName || path.basename(installDir),
    map: detectMap(installDir),
    rconPassword: serverSettings.ServerAdminPassword ?? '',
    mods,
    gamePort: parsePort(serverSettings.Port),
    queryPort: parsePort(serverSettings.QueryPort),
    rconPort: parsePort(serverSettings.RCONPort)
  }
}

/** Appends " (2)", " (3)", ... until the name doesn't collide with an existing one. */
export function uniqueProfileName(base: string, existingNames: string[]): string {
  const name = base.trim() || 'Imported Server'
  const taken = new Set(existingNames)
  if (!taken.has(name)) return name

  let suffix = 2
  while (taken.has(`${name} (${suffix})`)) suffix++
  return `${name} (${suffix})`
}
