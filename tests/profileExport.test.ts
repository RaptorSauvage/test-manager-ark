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
    ...overrides
  }
}

describe('serializeProfile', () => {
  it('round-trips through JSON.parse', () => {
    const profile = makeProfile({ name: 'My Server' })
    expect(JSON.parse(serializeProfile(profile))).toEqual(profile)
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
})
