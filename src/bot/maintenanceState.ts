// In-memory only, deliberately not persisted to disk - a bot restart clears every
// maintenance flag, disabled-server flag, and the bot's own maintenance mode, same as the
// standalone Python bot (see its README's "Mode maintenance non persistant" note). Keyed by
// the Manager's own server id (stable across a rename) rather than by name, unlike the
// standalone bot which only ever had a name to key by.

export interface MaintenanceEntry {
  reason?: string
}

const arkMaintenance = new Map<string, MaintenanceEntry>()
const mcMaintenance = new Map<string, MaintenanceEntry>()
const disabledServerIds = new Set<string>()
let botMaintenanceMode = false

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
}

export function isBotMaintenanceMode(): boolean {
  return botMaintenanceMode
}

export function setBotMaintenanceMode(value: boolean): void {
  botMaintenanceMode = value
}
