import { describe, expect, it } from 'vitest'
import { migrateProfile } from '../src/main/lib/profileMigration'
import type { ServerProfile } from '../shared/types'

function baseProfile(overrides: Record<string, unknown>): ServerProfile {
  return {
    id: 'test',
    name: 'Test',
    installDir: '/tmp/ark',
    map: 'TheIsland_WP',
    gamePort: 7777,
    queryPort: 27015,
    rconPort: 27020,
    rconPassword: '',
    savedArksSubPath: 'ShooterGame/Saved/SavedArks',
    backupDir: '',
    maxBackups: 10,
    extraArgs: '',
    mods: [],
    ...overrides
  } as ServerProfile
}

describe('migrateProfile', () => {
  it('leaves an already-current profile untouched', () => {
    const profile = baseProfile({ mods: [{ id: '111', enabled: true, dev: true, name: 'Foo' }] })
    expect(migrateProfile(profile)).toEqual(profile)
  })

  it('converts legacy activeMods:string[] into mods:ServerMod[]', () => {
    const legacy = baseProfile({ mods: undefined, activeMods: ['111', '222'] })
    const migrated = migrateProfile(legacy)
    expect(migrated.mods).toEqual([
      { id: '111', enabled: true, dev: false },
      { id: '222', enabled: true, dev: false }
    ])
    expect('activeMods' in migrated).toBe(false)
  })

  it('backfills a missing dev flag on existing ServerMod entries', () => {
    const profile = baseProfile({ mods: [{ id: '111', enabled: false }] })
    const migrated = migrateProfile(profile)
    expect(migrated.mods).toEqual([{ id: '111', enabled: false, dev: false }])
  })
})
