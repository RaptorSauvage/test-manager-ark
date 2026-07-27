import { describe, expect, it } from 'vitest'
import { reorderProfiles } from '../src/main/lib/reorder'
import type { ServerProfile } from '../shared/types'

function profile(id: string): ServerProfile {
  return {
    id,
    name: `Profile ${id}`,
    installDir: '/tmp/ark',
    map: 'TheIsland_WP',
    moddedMapEnabled: false,
    moddedMapId: '',
    gamePort: 7777,
    rconPort: 27020,
    serverPlatform: 'PC',
    maxPlayers: 70,
    backupDir: '',
    maxBackups: 10,
    backupScheduleEnabled: false,
    playerProfileBackupEnabled: false,
    playerProfileBackupMaxPerPlayer: 20,
    mods: [],
    clusterEnabled: false,
    clusterId: '',
    clusterDirOverride: '',
    noTransferFromFiltering: false,
    externalIp: '',
    cultureSettings: 'none',
    disableBattlEye: false,
    rconTribeLog: false,
    forceRespawnDinos: false,
    noSound: false,
    extraArgs: '',
    scheduledRestartEnabled: false,
    scheduledRestartTime: '00:00',
    scheduledRestartDays: [],
    scheduledRestartUpdateAfter: false,
    scheduledRestartStartAfter: false,
    scheduledDinoWipeEnabled: false,
    scheduledDinoWipeTime: '00:00',
    scheduledDinoWipeDays: []
  }
}

describe('reorderProfiles', () => {
  it('reorders profiles to match the given id order', () => {
    const profiles = [profile('a'), profile('b'), profile('c')]
    const reordered = reorderProfiles(profiles, ['c', 'a', 'b'])
    expect(reordered.map((p) => p.id)).toEqual(['c', 'a', 'b'])
  })

  it('ignores ids that do not match any profile', () => {
    const profiles = [profile('a'), profile('b')]
    const reordered = reorderProfiles(profiles, ['b', 'ghost', 'a'])
    expect(reordered.map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('appends profiles missing from orderedIds at the end, preserving their relative order', () => {
    const profiles = [profile('a'), profile('b'), profile('c')]
    const reordered = reorderProfiles(profiles, ['c'])
    expect(reordered.map((p) => p.id)).toEqual(['c', 'a', 'b'])
  })
})
