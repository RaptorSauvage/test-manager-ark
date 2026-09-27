import { describe, it, expect, vi, beforeEach } from 'vitest'

// Same minimal in-memory electron-store stand-in as tests/webDashboardRoleMigration.test.ts,
// with one addition: __getRawData() exposes the single store instance's underlying data, so a
// test can confirm migrateProfile()'s backfills were actually persisted back to the store -
// not just applied in-memory on every listProfiles() call, which was already true before this
// and wouldn't prove anything about persistence on its own.
vi.mock('electron-store', () => {
  let seed: Record<string, unknown> = {}
  let lastInstanceData: Record<string, unknown> | null = null
  return {
    default: class MockStore {
      private data: Record<string, unknown>
      constructor(opts: { defaults: Record<string, unknown> }) {
        this.data = { ...structuredClone(opts.defaults), ...structuredClone(seed) }
        lastInstanceData = this.data
      }
      get(key: string): unknown {
        return this.data[key]
      }
      set(key: string, value: unknown): void {
        this.data[key] = value
      }
    },
    __setSeed: (next: Record<string, unknown>) => {
      seed = next
    },
    __getRawData: () => lastInstanceData
  }
})

describe('profile game-field migration is persisted to disk', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('backfills a legacy profile (no game field) to ark-ascended, and writes it back to the store', async () => {
    const { __setSeed, __getRawData } = (await import('electron-store')) as unknown as {
      __setSeed: (s: Record<string, unknown>) => void
      __getRawData: () => Record<string, unknown> | null
    }
    __setSeed({
      profiles: [{ id: 'legacy-1', name: 'Legacy Server', installDir: '/tmp/ark', map: 'TheIsland_WP' }]
    })

    const { listProfiles } = await import('../src/main/store')

    expect(listProfiles().find((p) => p.id === 'legacy-1')?.game).toBe('ark-ascended')

    const raw = __getRawData()
    const rawProfiles = raw?.profiles as Array<{ id: string; game?: string }>
    expect(rawProfiles.find((p) => p.id === 'legacy-1')?.game).toBe('ark-ascended')
    expect(raw?.profilesMigratedToDisk).toBe(true)
  })

  it('only writes the migration once - a second listProfiles() call is a no-op on the flag', async () => {
    const { __setSeed, __getRawData } = (await import('electron-store')) as unknown as {
      __setSeed: (s: Record<string, unknown>) => void
      __getRawData: () => Record<string, unknown> | null
    }
    __setSeed({
      profiles: [{ id: 'legacy-1', name: 'Legacy Server', installDir: '/tmp/ark', map: 'TheIsland_WP' }]
    })

    const { listProfiles } = await import('../src/main/store')
    listProfiles()
    const rawAfterFirst = __getRawData()
    listProfiles()
    const rawAfterSecond = __getRawData()

    expect(rawAfterFirst?.profilesMigratedToDisk).toBe(true)
    expect(rawAfterSecond?.profilesMigratedToDisk).toBe(true)
    expect(rawAfterSecond).toEqual(rawAfterFirst)
  })
})
