import { describe, expect, it } from 'vitest'
import { migrateProfile } from '../src/main/lib/profileMigration'
import type { ServerProfile } from '../shared/types'

function baseProfile(overrides: Record<string, unknown>): ServerProfile {
  return {
    id: 'test',
    name: 'Test',
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
    scheduledDinoWipeDays: [],
    mods: [],
    ...overrides
  } as ServerProfile
}

describe('migrateProfile', () => {
  it('leaves an already-current profile untouched', () => {
    const profile = baseProfile({ mods: [{ id: '111', enabled: true, passive: false, dev: true, name: 'Foo' }] })
    expect(migrateProfile(profile)).toEqual(profile)
  })

  it('converts legacy activeMods:string[] into mods:ServerMod[]', () => {
    const legacy = baseProfile({ mods: undefined, activeMods: ['111', '222'] })
    const migrated = migrateProfile(legacy)
    expect(migrated.mods).toEqual([
      { id: '111', enabled: true, passive: false, dev: false },
      { id: '222', enabled: true, passive: false, dev: false }
    ])
    expect('activeMods' in migrated).toBe(false)
  })

  it('backfills missing passive/dev flags on existing ServerMod entries', () => {
    const profile = baseProfile({ mods: [{ id: '111', enabled: false }] })
    const migrated = migrateProfile(profile)
    expect(migrated.mods).toEqual([{ id: '111', enabled: false, passive: false, dev: false }])
  })

  it('infers backupScheduleEnabled:true for legacy profiles that already had a cron string', () => {
    const legacy = baseProfile({ backupScheduleEnabled: undefined, backupSchedule: '0 */6 * * *' })
    expect(migrateProfile(legacy).backupScheduleEnabled).toBe(true)
  })

  it('defaults backupScheduleEnabled to false when there is no existing schedule either', () => {
    const legacy = baseProfile({ backupScheduleEnabled: undefined, backupSchedule: undefined })
    expect(migrateProfile(legacy).backupScheduleEnabled).toBe(false)
  })

  it('backfills cluster fields on profiles saved before they existed', () => {
    const legacy = baseProfile({
      clusterEnabled: undefined,
      clusterId: undefined,
      clusterDirOverride: undefined,
      noTransferFromFiltering: undefined
    })
    const migrated = migrateProfile(legacy)
    expect(migrated.clusterEnabled).toBe(false)
    expect(migrated.clusterId).toBe('')
    expect(migrated.clusterDirOverride).toBe('')
    expect(migrated.noTransferFromFiltering).toBe(false)
  })

  it('defaults serverPlatform to PC on profiles saved before it existed', () => {
    const legacy = baseProfile({ serverPlatform: undefined })
    expect(migrateProfile(legacy).serverPlatform).toBe('PC')
  })

  it('drops the removed rconPassword/queryPort fields from legacy profiles', () => {
    const legacy = baseProfile({ rconPassword: 'old-secret', queryPort: 27015 })
    const migrated = migrateProfile(legacy)
    expect('rconPassword' in migrated).toBe(false)
    expect('queryPort' in migrated).toBe(false)
  })

  it('drops the removed savedArksSubPath field from legacy profiles', () => {
    const legacy = baseProfile({ savedArksSubPath: 'ShooterGame/Saved/SavedArks' })
    const migrated = migrateProfile(legacy)
    expect('savedArksSubPath' in migrated).toBe(false)
  })

  it('drops the removed scheduledRestartDestroyWildDinosAfter field from legacy profiles', () => {
    const legacy = baseProfile({ scheduledRestartDestroyWildDinosAfter: true })
    const migrated = migrateProfile(legacy)
    expect('scheduledRestartDestroyWildDinosAfter' in migrated).toBe(false)
  })

  it('backfills maxPlayers/externalIp/cultureSettings/battlEye/tribeLog/respawn/sound fields', () => {
    const legacy = baseProfile({
      maxPlayers: undefined,
      externalIp: undefined,
      cultureSettings: undefined,
      disableBattlEye: undefined,
      rconTribeLog: undefined,
      forceRespawnDinos: undefined,
      noSound: undefined
    })
    const migrated = migrateProfile(legacy)
    expect(migrated.maxPlayers).toBe(70)
    expect(migrated.externalIp).toBe('')
    expect(migrated.cultureSettings).toBe('none')
    expect(migrated.disableBattlEye).toBe(false)
    expect(migrated.rconTribeLog).toBe(false)
    expect(migrated.forceRespawnDinos).toBe(false)
    expect(migrated.noSound).toBe(false)
  })

  it('backfills moddedMapEnabled/moddedMapId on profiles saved before they existed', () => {
    const legacy = baseProfile({ moddedMapEnabled: undefined, moddedMapId: undefined })
    const migrated = migrateProfile(legacy)
    expect(migrated.moddedMapEnabled).toBe(false)
    expect(migrated.moddedMapId).toBe('')
  })

  it('defaults playerProfileBackupEnabled to false on profiles saved before it existed', () => {
    const legacy = baseProfile({ playerProfileBackupEnabled: undefined })
    expect(migrateProfile(legacy).playerProfileBackupEnabled).toBe(false)
  })

  it('defaults playerProfileBackupMaxPerPlayer to 20 on profiles saved before it existed', () => {
    const legacy = baseProfile({ playerProfileBackupMaxPerPlayer: undefined })
    expect(migrateProfile(legacy).playerProfileBackupMaxPerPlayer).toBe(20)
  })
})
