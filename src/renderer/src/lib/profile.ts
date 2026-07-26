import type { ServerProfile } from '@shared/types'

export function createDefaultProfile(name: string): ServerProfile {
  return {
    id: crypto.randomUUID(),
    name,
    installDir: '',
    map: 'TheIsland_WP',
    gamePort: 7777,
    queryPort: 27015,
    rconPort: 27020,
    rconPassword: '',
    savedArksSubPath: 'ShooterGame/Saved/SavedArks',
    backupDir: '',
    maxBackups: 10,
    backupSchedule: '',
    backupScheduleEnabled: false,
    mods: [],
    clusterEnabled: false,
    clusterId: '',
    clusterDirOverride: '',
    noTransferFromFiltering: false,
    extraArgs: ''
  }
}
