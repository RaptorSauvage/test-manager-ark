import { describe, expect, it } from 'vitest'
import { parseClusterBundle } from '../src/main/lib/clusterExport'
import type { ClusterBundle, ServerProfile } from '../shared/types'
import type { MinecraftProfile } from '../shared/minecraft'

function minimalArkProfile(overrides: Partial<ServerProfile> = {}): Partial<ServerProfile> {
  return { id: 'ark-1', name: 'My ARK Server', installDir: '/tmp/ark', map: 'TheIsland_WP', group: '', ...overrides }
}

function minimalMcProfile(overrides: Partial<MinecraftProfile> = {}): Partial<MinecraftProfile> {
  return { id: 'mc-1', name: 'My Minecraft Server', installDir: '/tmp/mc', group: '', ...overrides }
}

function makeBundleJson(overrides: Partial<ClusterBundle> = {}): string {
  return JSON.stringify({
    version: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    profiles: [minimalArkProfile()],
    minecraftProfiles: [minimalMcProfile()],
    settings: { steamCmdPath: '/tmp/steamcmd' },
    ...overrides
  })
}

describe('parseClusterBundle', () => {
  it('rejects invalid JSON', () => {
    expect(() => parseClusterBundle('{not valid', [], [])).toThrow('not valid JSON')
  })

  it('rejects a file that is not an object', () => {
    expect(() => parseClusterBundle('[]', [], [])).toThrow('does not contain a cluster backup')
    expect(() => parseClusterBundle('"hello"', [], [])).toThrow('does not contain a cluster backup')
  })

  it('rejects an object missing the expected shape', () => {
    expect(() => parseClusterBundle(JSON.stringify({ profiles: [] }), [], [])).toThrow(
      'does not look like a valid cluster backup'
    )
    expect(() => parseClusterBundle(JSON.stringify({ profiles: [], minecraftProfiles: [] }), [], [])).toThrow(
      'does not look like a valid cluster backup'
    )
  })

  it('migrates each profile and gives it a fresh id', () => {
    const bundle = parseClusterBundle(makeBundleJson(), [], [])
    expect(bundle.profiles).toHaveLength(1)
    expect(bundle.profiles[0].id).not.toBe('ark-1')
    expect(bundle.profiles[0].name).toBe('My ARK Server')
    // migrateProfile backfills fields that didn't exist in the minimal fixture.
    expect(bundle.profiles[0].maxPlayers).toBe(70)

    expect(bundle.minecraftProfiles).toHaveLength(1)
    expect(bundle.minecraftProfiles[0].id).not.toBe('mc-1')
    expect(bundle.minecraftProfiles[0].name).toBe('My Minecraft Server')
  })

  it('renames an ARK profile that collides with an existing name, independently from Minecraft', () => {
    const bundle = parseClusterBundle(makeBundleJson(), ['My ARK Server'], [])
    expect(bundle.profiles[0].name).toBe('My ARK Server (2)')
    expect(bundle.minecraftProfiles[0].name).toBe('My Minecraft Server')
  })

  it('renames a Minecraft profile that collides with an existing name, independently from ARK', () => {
    const bundle = parseClusterBundle(makeBundleJson(), [], ['My Minecraft Server'])
    expect(bundle.profiles[0].name).toBe('My ARK Server')
    expect(bundle.minecraftProfiles[0].name).toBe('My Minecraft Server (2)')
  })

  it('renames multiple colliding profiles of the same game against each other, not just the existing list', () => {
    const bundle = parseClusterBundle(
      makeBundleJson({ profiles: [minimalArkProfile({ id: 'a' }), minimalArkProfile({ id: 'b' })] }),
      ['My ARK Server'],
      []
    )
    const names = bundle.profiles.map((p) => p.name).sort()
    expect(names).toEqual(['My ARK Server (2)', 'My ARK Server (3)'])
  })

  it('passes the settings object through unchanged', () => {
    const bundle = parseClusterBundle(makeBundleJson({ settings: { steamCmdPath: 'C:\\steamcmd.exe' } as never }), [], [])
    expect((bundle.settings as { steamCmdPath: string }).steamCmdPath).toBe('C:\\steamcmd.exe')
  })

  it('falls back to the current time when exportedAt is missing/invalid', () => {
    const bundle = parseClusterBundle(makeBundleJson({ exportedAt: undefined as never }), [], [])
    expect(typeof bundle.exportedAt).toBe('string')
    expect(bundle.exportedAt.length).toBeGreaterThan(0)
  })
})
