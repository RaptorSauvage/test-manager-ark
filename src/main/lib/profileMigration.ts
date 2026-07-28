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
  /** Removed - folded into the separate, independent scheduled dino wipe instead */
  scheduledRestartDestroyWildDinosAfter?: boolean
}

/**
 * Normalizes profiles saved by older versions of the app:
 * - `activeMods: string[]` became `mods: ServerMod[]`
 * - `ServerMod` gained required `dev` and `passive` flags
 * - `backupScheduleEnabled` is new; profiles that already had a cron string
 *   keep working (treated as enabled), everyone else defaults to off
 * - `clusterEnabled`/`clusterId`/`clusterDirOverride`/`noTransferFromFiltering`
 *   are new and default to off/empty
 * - `maxPlayers`/`externalIp`/`cultureSettings`/`disableBattlEye`/`rconTribeLog`/
 *   `forceRespawnDinos`/`noSound`/`playerProfileBackupEnabled`/
 *   `playerProfileBackupMaxPerPlayer` are new and default to off/empty/70 players/20
 * - `scheduledRestart*`/`scheduledDinoWipe*` are new and default to off/00:00/no days
 * - `scheduledRestartDestroyWildDinosAfter` was dropped from the restart schedule -
 *   folded into the separate, independent scheduled dino wipe instead
 * - `hidden` is new and defaults to false (shown on the dashboard)
 * - `group` is new and defaults to '' (no dashboard group)
 */
export function migrateProfile(raw: ServerProfile & LegacyProfileFields): ServerProfile {
  const {
    activeMods,
    rconPassword: _rconPassword,
    queryPort: _queryPort,
    savedArksSubPath: _savedArksSubPath,
    scheduledRestartDestroyWildDinosAfter: _scheduledRestartDestroyWildDinosAfter,
    ...rest
  } = raw
  const sourceMods: Array<Partial<ServerMod> & { id: string }> = Array.isArray(rest.mods)
    ? rest.mods
    : (activeMods ?? []).map((id) => ({ id }))

  const mods: ServerMod[] = sourceMods.map((mod) => ({
    id: mod.id,
    name: mod.name,
    enabled: mod.enabled ?? true,
    passive: mod.passive ?? false,
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
    serverPlatform: rest.serverPlatform ?? 'PC',
    maxPlayers: rest.maxPlayers ?? 70,
    externalIp: rest.externalIp ?? '',
    cultureSettings: rest.cultureSettings ?? 'none',
    disableBattlEye: rest.disableBattlEye ?? false,
    rconTribeLog: rest.rconTribeLog ?? false,
    forceRespawnDinos: rest.forceRespawnDinos ?? false,
    noSound: rest.noSound ?? false,
    moddedMapEnabled: rest.moddedMapEnabled ?? false,
    moddedMapId: rest.moddedMapId ?? '',
    playerProfileBackupEnabled: rest.playerProfileBackupEnabled ?? false,
    playerProfileBackupMaxPerPlayer: rest.playerProfileBackupMaxPerPlayer ?? 20,
    scheduledRestartEnabled: rest.scheduledRestartEnabled ?? false,
    scheduledRestartTime: rest.scheduledRestartTime ?? '00:00',
    scheduledRestartDays: rest.scheduledRestartDays ?? [],
    scheduledRestartUpdateAfter: rest.scheduledRestartUpdateAfter ?? false,
    scheduledRestartStartAfter: rest.scheduledRestartStartAfter ?? false,
    scheduledDinoWipeEnabled: rest.scheduledDinoWipeEnabled ?? false,
    scheduledDinoWipeTime: rest.scheduledDinoWipeTime ?? '00:00',
    scheduledDinoWipeDays: rest.scheduledDinoWipeDays ?? [],
    hidden: rest.hidden ?? false,
    group: rest.group ?? ''
  }
}
