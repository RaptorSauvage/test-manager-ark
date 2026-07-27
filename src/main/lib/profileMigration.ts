import type { ServerProfile, ServerMod } from '@shared/types'

interface LegacyProfileFields {
  activeMods?: string[]
  backupScheduleEnabled?: boolean
  clusterEnabled?: boolean
  clusterId?: string
  clusterDirOverride?: string
  noTransferFromFiltering?: boolean
  serverPlatform?: 'PC' | 'ALL'
  /** Removed - RCON/admin password is now always read live from GameUserSettings.ini */
  rconPassword?: string
  /** Removed - ARK:SA doesn't use a separate query port */
  queryPort?: number
  /** Removed - the SavedArks location is always ShooterGame/Saved/SavedArks */
  savedArksSubPath?: string
}

/**
 * Normalizes profiles saved by older versions of the app:
 * - `activeMods: string[]` became `mods: ServerMod[]`
 * - `ServerMod` gained a required `dev` flag
 * - `backupScheduleEnabled` is new; profiles that already had a cron string
 *   keep working (treated as enabled), everyone else defaults to off
 * - `clusterEnabled`/`clusterId`/`clusterDirOverride`/`noTransferFromFiltering`
 *   are new and default to off/empty
 */
export function migrateProfile(raw: ServerProfile & LegacyProfileFields): ServerProfile {
  const {
    activeMods,
    rconPassword: _rconPassword,
    queryPort: _queryPort,
    savedArksSubPath: _savedArksSubPath,
    ...rest
  } = raw
  const sourceMods: Array<Partial<ServerMod> & { id: string }> = Array.isArray(rest.mods)
    ? rest.mods
    : (activeMods ?? []).map((id) => ({ id }))

  const mods: ServerMod[] = sourceMods.map((mod) => ({
    id: mod.id,
    name: mod.name,
    enabled: mod.enabled ?? true,
    dev: mod.dev ?? false
  }))

  const backupScheduleEnabled = rest.backupScheduleEnabled ?? Boolean(rest.backupSchedule)

  return {
    ...rest,
    mods,
    backupScheduleEnabled,
    clusterEnabled: rest.clusterEnabled ?? false,
    clusterId: rest.clusterId ?? '',
    clusterDirOverride: rest.clusterDirOverride ?? '',
    noTransferFromFiltering: rest.noTransferFromFiltering ?? false,
    serverPlatform: rest.serverPlatform ?? 'PC'
  }
}
