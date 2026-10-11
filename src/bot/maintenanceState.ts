// Maintenance flags and the bot's own maintenance mode are in-memory only, deliberately not
// persisted to disk - a bot restart clears them, same as the standalone Python bot (see its
// README's "Mode maintenance non persistant" note). Keyed by the Manager's own server id
// (stable across a rename) rather than by name, unlike the standalone bot which only ever
// had a name to key by.
//
// The disabled-servers set (/check off) is the one exception: it now persists to a JSON
// file (disabled_servers.json in the bot's own state dir) - see initMaintenanceState below.
// The standalone bot had a static, persistent DISABLED_SERVERS list in .env *and* a
// non-persistent /check toggle layered on top of it; folding both into one persisted toggle
// is simpler and strictly more useful (no more having to re-run /check off after every bot
// restart to keep a decommissioned server out of the embed).
import fs from 'node:fs'
import path from 'node:path'
import { log } from './logging'

export interface MaintenanceEntry {
  reason?: string
}

const arkMaintenance = new Map<string, MaintenanceEntry>()
const mcMaintenance = new Map<string, MaintenanceEntry>()
const disabledServerIds = new Set<string>()
let botMaintenanceMode = false
let disabledServersFilePath: string | null = null

function disabledServersFile(): string | null {
  return disabledServersFilePath
}

/** Loads the persisted disabled-servers set from `stateDir` - call once, right after
 *  loading the bot's own config, before any command can read/write the set. Safe to call
 *  more than once (e.g. in tests): each call replaces the in-memory set with whatever is on
 *  disk for the new path. */
export function initMaintenanceState(stateDir: string): void {
  disabledServersFilePath = path.join(stateDir, 'disabled_servers.json')
  disabledServerIds.clear()
  try {
    if (!fs.existsSync(disabledServersFilePath)) return
    const raw = JSON.parse(fs.readFileSync(disabledServersFilePath, 'utf-8')) as unknown
    if (Array.isArray(raw)) {
      for (const id of raw) if (typeof id === 'string') disabledServerIds.add(id)
    }
  } catch (err) {
    log.warn(`Impossible de lire ${disabledServersFilePath} (${(err as Error).message}) - liste des serveurs désactivés vide au démarrage.`)
  }
}

function persistDisabledServers(): void {
  const filePath = disabledServersFile()
  if (!filePath) return
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify([...disabledServerIds]), 'utf-8')
  } catch (err) {
    log.error(`Impossible d'écrire ${filePath} : ${(err as Error).message}`)
  }
}

export function getArkMaintenance(serverId: string): MaintenanceEntry | undefined {
  return arkMaintenance.get(serverId)
}

export function setArkMaintenance(serverId: string, entry: MaintenanceEntry | null): void {
  if (entry) arkMaintenance.set(serverId, entry)
  else arkMaintenance.delete(serverId)
}

export function allArkMaintenanceIds(): Set<string> {
  return new Set(arkMaintenance.keys())
}

export function getMcMaintenance(serverId: string): MaintenanceEntry | undefined {
  return mcMaintenance.get(serverId)
}

export function setMcMaintenance(serverId: string, entry: MaintenanceEntry | null): void {
  if (entry) mcMaintenance.set(serverId, entry)
  else mcMaintenance.delete(serverId)
}

export function allMcMaintenanceIds(): Set<string> {
  return new Set(mcMaintenance.keys())
}

/** `/check off` - excludes a server from the aggregate `/status` embed and its counts
 *  entirely (it's still a real profile in the Manager, just not something this Discord
 *  integration should surface) - see README for why this no longer means "stop polling via
 *  RCON" the way it did in the standalone bot (there's no separate RCON polling anymore). */
export function isCheckDisabled(serverId: string): boolean {
  return disabledServerIds.has(serverId)
}

export function setCheckDisabled(serverId: string, disabled: boolean): void {
  if (disabled) disabledServerIds.add(serverId)
  else disabledServerIds.delete(serverId)
  persistDisabledServers()
}

export function isBotMaintenanceMode(): boolean {
  return botMaintenanceMode
}

export function setBotMaintenanceMode(value: boolean): void {
  botMaintenanceMode = value
}
