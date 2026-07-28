import { describe, expect, it } from 'vitest'
import { serializeProfile, parseImportedProfile } from '../src/main/lib/profileExport'
import type { ServerProfile } from '../shared/types'

function makeProfile(overrides: Partial<ServerProfile> = {}): ServerProfile {
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
    scheduledDinoWipeDays: [],
    hidden: false,
    group: '',
    ...overrides
  }
}

describe('serializeProfile', () => {
  it('round-trips through JSON.parse', () => {
    const profile = makeProfile({ name: 'My Server' })
    expect(JSON.parse(serializeProfile(profile))).toEqual(profile)
  })

  it('round-trips a fully configured profile - Settings, Backups, and Mods tab options all together', () => {
    const profile = makeProfile({
      // Settings tab
      name: 'Modded Cluster Server',
      installDir: 'C:\\ARK\\Server',
      map: 'Ragnarok_WP',
      moddedMapEnabled: true,
      moddedMapId: '1234567',
      gamePort: 7778,
      rconPort: 27021,
      serverPlatform: 'ALL',
      maxPlayers: 20,
      clusterEnabled: true,
      clusterId: 'my-cluster',
      clusterDirOverride: 'C:\\ARK\\ClusterData',
      noTransferFromFiltering: true,
      externalIp: '203.0.113.10',
      cultureSettings: 'fr',
      disableBattlEye: true,
      rconTribeLog: true,
      forceRespawnDinos: true,
      noSound: true,
      extraArgs: '-SomeExtraFlag',
      // Backups tab
      backupDir: 'D:\\ArkBackups',
      maxBackups: 15,
      backupScheduleEnabled: true,
      backupSchedule: '0 */6 * * *',
      playerProfileBackupEnabled: true,
      playerProfileBackupMaxPerPlayer: 5,
      // Mods tab
      mods: [
        { id: '1232293', name: 'Bober Stacks', enabled: true, passive: false, dev: false },
        { id: '930391', name: 'Random Configs', enabled: false, passive: false, dev: false },
        { id: '1219028', name: 'Orbital Satellite Uplink', enabled: true, passive: true, dev: true }
      ]
    })

    const imported = parseImportedProfile(serializeProfile(profile), [])
    const { id: _id, name: _name, ...withoutIdAndName } = imported
    const { id: _origId, name: _origName, ...expected } = profile
    expect(withoutIdAndName).toEqual(expected)
  })
})

describe('parseImportedProfile', () => {
  it('parses a previously exported profile, assigning a fresh id and keeping the name if unique', () => {
    const profile = makeProfile({ id: 'original-id', name: 'My Server' })
    const imported = parseImportedProfile(serializeProfile(profile), [])
    expect(imported.id).not.toBe('original-id')
    expect(imported.name).toBe('My Server')
    expect(imported.installDir).toBe('/tmp/ark')
  })

  it('deduplicates the name against existing profiles', () => {
    const profile = makeProfile({ name: 'My Server' })
    const imported = parseImportedProfile(serializeProfile(profile), ['My Server'])
    expect(imported.name).toBe('My Server (2)')
  })

  it('rejects invalid JSON', () => {
    expect(() => parseImportedProfile('not json', [])).toThrow(/not valid JSON/)
  })

  it('rejects JSON that is not an object', () => {
    expect(() => parseImportedProfile('[1,2,3]', [])).toThrow(/does not contain a server profile/)
    expect(() => parseImportedProfile('"just a string"', [])).toThrow(/does not contain a server profile/)
  })

  it('rejects an object missing the required installDir/map fields', () => {
    expect(() => parseImportedProfile(JSON.stringify({ name: 'Empty' }), [])).toThrow(/valid server profile export/)
  })

  it('backfills fields added since the exported profile was made, via migration', () => {
    const legacy = { ...makeProfile(), maxPlayers: undefined, externalIp: undefined }
    delete (legacy as Record<string, unknown>).maxPlayers
    delete (legacy as Record<string, unknown>).externalIp
    const imported = parseImportedProfile(JSON.stringify(legacy), [])
    expect(imported.maxPlayers).toBe(70)
    expect(imported.externalIp).toBe('')
  })

  it('imports a genuinely old-style export missing every field added since v1, all at once', () => {
    // Simulates a real file exported by an early version of the app: only the fields
    // that existed back then, nothing added later.
    const veryOldExport = {
      id: 'original-id',
      name: 'Old Server',
      installDir: '/tmp/ark',
      map: 'TheIsland_WP',
      gamePort: 7777,
      rconPort: 27020,
      backupDir: '',
      maxBackups: 10,
      activeMods: ['111', '222']
    }

    const imported = parseImportedProfile(JSON.stringify(veryOldExport), [])

    expect(imported.moddedMapEnabled).toBe(false)
    expect(imported.moddedMapId).toBe('')
    expect(imported.serverPlatform).toBe('PC')
    expect(imported.maxPlayers).toBe(70)
    expect(imported.backupScheduleEnabled).toBe(false)
    expect(imported.playerProfileBackupEnabled).toBe(false)
    expect(imported.playerProfileBackupMaxPerPlayer).toBe(20)
    expect(imported.mods).toEqual([
      { id: '111', enabled: true, passive: false, dev: false },
      { id: '222', enabled: true, passive: false, dev: false }
    ])
    expect(imported.clusterEnabled).toBe(false)
    expect(imported.clusterId).toBe('')
    expect(imported.clusterDirOverride).toBe('')
    expect(imported.noTransferFromFiltering).toBe(false)
    expect(imported.externalIp).toBe('')
    expect(imported.cultureSettings).toBe('none')
    expect(imported.disableBattlEye).toBe(false)
    expect(imported.rconTribeLog).toBe(false)
    expect(imported.forceRespawnDinos).toBe(false)
    expect(imported.noSound).toBe(false)
    expect('activeMods' in imported).toBe(false)
  })
})
