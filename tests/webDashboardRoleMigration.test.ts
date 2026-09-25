import { describe, it, expect, vi, beforeEach } from 'vitest'

// A minimal in-memory stand-in for electron-store - just enough of the get/set surface
// store.ts actually uses, with no dependency on a real Electron `app` (which isn't
// available outside a real Electron process, unlike this plain vitest run). `__setSeed`
// lets a test simulate a persisted file that already existed before this "app instance"
// ever ran - i.e. genuinely pre-existing data, as opposed to data this same test wrote
// through store.ts's own save functions (which would have already gone through the
// migration guard once, unlike a real legacy file).
vi.mock('electron-store', () => {
  let seed: Record<string, unknown> = {}
  return {
    default: class MockStore {
      private data: Record<string, unknown>
      constructor(opts: { defaults: Record<string, unknown> }) {
        this.data = { ...structuredClone(opts.defaults), ...structuredClone(seed) }
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
    }
  }
})

describe('web dashboard access token / API key role migration', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('migrates a legacy stored admin/operator role exactly once, persisting the result', async () => {
    const { __setSeed } = (await import('electron-store')) as unknown as { __setSeed: (s: Record<string, unknown>) => void }
    __setSeed({
      webDashboardAccessTokens: [
        { id: 'legacy-admin', label: 'Legacy admin token', secretHash: 'hash', role: 'admin', profileIds: null, createdAt: 1 }
      ],
      webDashboardApiKeys: [
        { id: 'legacy-operator', label: 'Legacy operator key', secretHash: 'hash', role: 'operator', createdAt: 2 }
      ]
    })

    const { listWebDashboardAccessTokens, listWebDashboardApiKeys } = await import('../src/main/store')

    expect(listWebDashboardAccessTokens().find((t) => t.id === 'legacy-admin')?.role).toBe('globalAdmin')
    expect(listWebDashboardApiKeys().find((k) => k.id === 'legacy-operator')?.role).toBe('moderator')
  })

  it('never re-migrates a freshly-created admin/moderator role token/key - the regression this guards against', async () => {
    // No seed this time - a clean store, exactly like the migration having already run
    // (or never having had any legacy data to begin with).
    const { __setSeed } = (await import('electron-store')) as unknown as { __setSeed: (s: Record<string, unknown>) => void }
    __setSeed({})

    const { listWebDashboardAccessTokens, listWebDashboardApiKeys, saveWebDashboardAccessToken, saveWebDashboardApiKey } =
      await import('../src/main/store')

    // Reading first (as the Settings screen does on open) is what used to trigger the bug -
    // it must not touch anything since there's nothing legacy to migrate.
    listWebDashboardAccessTokens()

    saveWebDashboardAccessToken({
      id: 'new-admin',
      label: 'New scoped admin token',
      secretHash: 'hash',
      role: 'admin',
      profileIds: ['p1'],
      createdAt: 3
    })
    saveWebDashboardApiKey({ id: 'new-moderator', label: 'New moderator key', secretHash: 'hash', role: 'moderator', createdAt: 4 })

    expect(listWebDashboardAccessTokens().find((t) => t.id === 'new-admin')?.role).toBe('admin')
    expect(listWebDashboardApiKeys().find((k) => k.id === 'new-moderator')?.role).toBe('moderator')

    // Reading again (simulating the app being reopened, or the Settings screen refreshing)
    // must not change anything either - this is exactly the bug that shipped: every read
    // re-promoted 'admin' to 'globalAdmin'.
    expect(listWebDashboardAccessTokens().find((t) => t.id === 'new-admin')?.role).toBe('admin')
  })
})
