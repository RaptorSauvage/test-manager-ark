import type { ServerProfile } from '@shared/types'

export function createDefaultProfile(name: string): ServerProfile {
  return {
    id: crypto.randomUUID(),
    name,
    installDir: '',
    map: 'TheIsland_WP',
    gamePort: 7777,
    rconPort: 27020,
    serverPlatform: 'PC',
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
