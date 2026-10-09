import { describe, expect, it } from 'vitest'
import { resolveCurseForgeInstallPlan } from '../src/main/lib/minecraftMods'
import type { CurseForgeFile } from '../src/main/lib/curseforgeClient'

const profile = { serverType: 'fabric' as const, minecraftVersion: '1.20.1' }

function makeFile(overrides: Partial<CurseForgeFile> = {}): CurseForgeFile {
  return {
    id: 1,
    modId: 100,
    fileName: 'root.jar',
    displayName: '1.0.0',
    downloadUrl: 'https://example.test/root.jar',
    gameVersions: ['1.20.1'],
    fileDate: '2026-01-01T00:00:00Z',
    hashes: [],
    dependencies: [],
    fileFingerprint: 0,
    ...overrides
  }
}

describe('resolveCurseForgeInstallPlan', () => {
  it('installs just the root when it has no dependencies', async () => {
    const plan = await resolveCurseForgeInstallPlan(100, makeFile(), profile, new Set(), {
      getModFiles: async () => []
    })
    expect(plan.toInstall).toHaveLength(1)
    expect(plan.toInstall[0].installedAs).toBe('user')
    expect(plan.optionalSkipped).toEqual([])
    expect(plan.incompatible).toEqual([])
  })

  it('resolves a required dependency (relationType 3) to its latest compatible file', async () => {
    const depFile = makeFile({ id: 2, modId: 200, fileName: 'dep.jar' })
    const root = makeFile({ dependencies: [{ modId: 200, relationType: 3 }] })

    const plan = await resolveCurseForgeInstallPlan(100, root, profile, new Set(), {
      getModFiles: async (modId) => {
        expect(modId).toBe(200)
        return [depFile]
      }
    })

    expect(plan.toInstall.map((r) => r.modId)).toEqual([100, 200])
    expect(plan.toInstall[1].installedAs).toBe('dependency')
  })

  it('never installs an embedded library (relationType 1) or a tool (4) or an include (6)', async () => {
    const root = makeFile({
      dependencies: [
        { modId: 201, relationType: 1 },
        { modId: 202, relationType: 4 },
        { modId: 203, relationType: 6 }
      ]
    })
    const plan = await resolveCurseForgeInstallPlan(100, root, profile, new Set(), {
      getModFiles: async () => {
        throw new Error('should not be called for embedded/tool/include dependencies')
      }
    })
    expect(plan.toInstall).toHaveLength(1)
  })

  it('never auto-installs an optional dependency (relationType 2), but surfaces it', async () => {
    const root = makeFile({ dependencies: [{ modId: 201, relationType: 2 }] })
    const plan = await resolveCurseForgeInstallPlan(100, root, profile, new Set(), {
      getModFiles: async () => {
        throw new Error('should not be called for an optional dependency')
      }
    })
    expect(plan.toInstall).toHaveLength(1)
    expect(plan.optionalSkipped).toEqual([{ projectId: '201', dependencyType: 'optional' }])
  })

  it('warns about an incompatible dependency (relationType 5) only when already installed', async () => {
    const root = makeFile({ dependencies: [{ modId: 201, relationType: 5 }] })
    const notInstalled = await resolveCurseForgeInstallPlan(100, root, profile, new Set(), {
      getModFiles: async () => []
    })
    expect(notInstalled.incompatible).toEqual([])

    const alreadyInstalled = await resolveCurseForgeInstallPlan(100, root, profile, new Set(['201']), {
      getModFiles: async () => []
    })
    expect(alreadyInstalled.incompatible).toEqual([{ projectId: '201', dependencyType: 'incompatible' }])
  })

  it('does not re-install a required dependency that is already installed', async () => {
    const root = makeFile({ dependencies: [{ modId: 201, relationType: 3 }] })
    const plan = await resolveCurseForgeInstallPlan(100, root, profile, new Set(['201']), {
      getModFiles: async () => {
        throw new Error('should not fetch files for an already-installed dependency')
      }
    })
    expect(plan.toInstall).toHaveLength(1)
  })

  it('handles a diamond dependency graph without installing the shared dependency twice', async () => {
    const shared = makeFile({ id: 3, modId: 300, fileName: 'shared.jar' })
    const depA = makeFile({ id: 4, modId: 301, fileName: 'a.jar', dependencies: [{ modId: 300, relationType: 3 }] })
    const depB = makeFile({ id: 5, modId: 302, fileName: 'b.jar', dependencies: [{ modId: 300, relationType: 3 }] })
    const root = makeFile({
      dependencies: [
        { modId: 301, relationType: 3 },
        { modId: 302, relationType: 3 }
      ]
    })
    const filesByModId: Record<number, CurseForgeFile[]> = { 301: [depA], 302: [depB], 300: [shared] }

    const plan = await resolveCurseForgeInstallPlan(100, root, profile, new Set(), {
      getModFiles: async (modId) => filesByModId[modId]
    })

    const modIds = plan.toInstall.map((r) => r.modId)
    expect(modIds).toEqual([100, 301, 302, 300])
    expect(modIds.filter((id) => id === 300)).toHaveLength(1)
  })

  it('does not infinite-loop on a dependency cycle', async () => {
    const depB = makeFile({ id: 7, modId: 401, fileName: 'b.jar', dependencies: [{ modId: 400, relationType: 3 }] })
    const depA = makeFile({ id: 6, modId: 400, fileName: 'a.jar', dependencies: [{ modId: 401, relationType: 3 }] })
    const root = makeFile({ dependencies: [{ modId: 400, relationType: 3 }] })
    const filesByModId: Record<number, CurseForgeFile[]> = { 400: [depA], 401: [depB] }

    const plan = await resolveCurseForgeInstallPlan(100, root, profile, new Set(), {
      getModFiles: async (modId) => filesByModId[modId]
    })

    expect(plan.toInstall.map((r) => r.modId)).toEqual([100, 400, 401])
  })
})
