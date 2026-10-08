import { describe, expect, it } from 'vitest'
import { resolveModInstallPlan } from '../src/main/lib/minecraftMods'
import type { ModrinthVersion } from '../src/main/lib/modrinthClient'

const profile = { serverType: 'fabric' as const, minecraftVersion: '1.20.1' }

function makeVersion(overrides: Partial<ModrinthVersion> = {}): ModrinthVersion {
  return {
    id: 'version-root',
    project_id: 'project-root',
    version_number: '1.0.0',
    game_versions: ['1.20.1'],
    loaders: ['fabric'],
    version_type: 'release',
    date_published: '2026-01-01T00:00:00Z',
    files: [{ hashes: {}, url: 'https://example.test/root.jar', filename: 'root.jar', primary: true, size: 100 }],
    dependencies: [],
    ...overrides
  }
}

describe('resolveModInstallPlan', () => {
  it('installs just the root when it has no dependencies', async () => {
    const plan = await resolveModInstallPlan(makeVersion(), profile, new Set(), {
      getProjectVersions: async () => [],
      getVersion: async () => makeVersion()
    })
    expect(plan.toInstall).toHaveLength(1)
    expect(plan.toInstall[0].installedAs).toBe('user')
    expect(plan.optionalSkipped).toEqual([])
    expect(plan.incompatible).toEqual([])
  })

  it('resolves a required dependency pinned to an exact version_id', async () => {
    const depVersion = makeVersion({ id: 'version-dep', project_id: 'project-dep' })
    const root = makeVersion({
      dependencies: [{ version_id: 'version-dep', project_id: null, file_name: null, dependency_type: 'required' }]
    })
    const getVersion = async (id: string): Promise<ModrinthVersion> => {
      expect(id).toBe('version-dep')
      return depVersion
    }
    const plan = await resolveModInstallPlan(root, profile, new Set(), {
      getProjectVersions: async () => [],
      getVersion
    })
    expect(plan.toInstall.map((r) => r.version.project_id)).toEqual(['project-root', 'project-dep'])
    expect(plan.toInstall[1].installedAs).toBe('dependency')
  })

  it('resolves a required dependency given only a project_id by picking the latest compatible version', async () => {
    const depVersion = makeVersion({ id: 'version-dep', project_id: 'project-dep' })
    const root = makeVersion({
      dependencies: [{ version_id: null, project_id: 'project-dep', file_name: null, dependency_type: 'required' }]
    })
    const plan = await resolveModInstallPlan(root, profile, new Set(), {
      getProjectVersions: async (projectId) => {
        expect(projectId).toBe('project-dep')
        return [depVersion]
      },
      getVersion: async () => {
        throw new Error('should not be called - this dependency has no version_id')
      }
    })
    expect(plan.toInstall.map((r) => r.version.project_id)).toEqual(['project-root', 'project-dep'])
  })

  it('never installs an embedded dependency - already bundled in the parent jar', async () => {
    const root = makeVersion({
      dependencies: [{ version_id: null, project_id: 'project-embedded', file_name: 'lib.jar', dependency_type: 'embedded' }]
    })
    const plan = await resolveModInstallPlan(root, profile, new Set(), {
      getProjectVersions: async () => {
        throw new Error('should not be called for an embedded dependency')
      },
      getVersion: async () => {
        throw new Error('should not be called for an embedded dependency')
      }
    })
    expect(plan.toInstall).toHaveLength(1)
  })

  it('never auto-installs an optional dependency, but surfaces it for the caller', async () => {
    const root = makeVersion({
      dependencies: [{ version_id: null, project_id: 'project-optional', file_name: null, dependency_type: 'optional' }]
    })
    const plan = await resolveModInstallPlan(root, profile, new Set(), {
      getProjectVersions: async () => {
        throw new Error('should not be called for an optional dependency')
      },
      getVersion: async () => {
        throw new Error('should not be called for an optional dependency')
      }
    })
    expect(plan.toInstall).toHaveLength(1)
    expect(plan.optionalSkipped).toEqual([{ projectId: 'project-optional', dependencyType: 'optional' }])
  })

  it('does not report an optional dependency that is already installed', async () => {
    const root = makeVersion({
      dependencies: [{ version_id: null, project_id: 'project-optional', file_name: null, dependency_type: 'optional' }]
    })
    const plan = await resolveModInstallPlan(root, profile, new Set(['project-optional']), {
      getProjectVersions: async () => [],
      getVersion: async () => makeVersion()
    })
    expect(plan.optionalSkipped).toEqual([])
  })

  it('warns about an incompatible dependency only when it is already installed', async () => {
    const root = makeVersion({
      dependencies: [{ version_id: null, project_id: 'project-conflict', file_name: null, dependency_type: 'incompatible' }]
    })
    const notInstalled = await resolveModInstallPlan(root, profile, new Set(), {
      getProjectVersions: async () => [],
      getVersion: async () => makeVersion()
    })
    expect(notInstalled.incompatible).toEqual([])

    const alreadyInstalled = await resolveModInstallPlan(root, profile, new Set(['project-conflict']), {
      getProjectVersions: async () => [],
      getVersion: async () => makeVersion()
    })
    expect(alreadyInstalled.incompatible).toEqual([{ projectId: 'project-conflict', dependencyType: 'incompatible' }])
  })

  it('does not re-install a required dependency that is already installed', async () => {
    const root = makeVersion({
      dependencies: [{ version_id: null, project_id: 'project-already', file_name: null, dependency_type: 'required' }]
    })
    const plan = await resolveModInstallPlan(root, profile, new Set(['project-already']), {
      getProjectVersions: async () => {
        throw new Error('should not fetch versions for an already-installed dependency')
      },
      getVersion: async () => {
        throw new Error('should not fetch versions for an already-installed dependency')
      }
    })
    expect(plan.toInstall).toHaveLength(1)
  })

  it('handles a diamond dependency graph without installing the shared dependency twice', async () => {
    // root -> depA (required), root -> depB (required), depA -> shared (required), depB -> shared (required)
    const shared = makeVersion({ id: 'v-shared', project_id: 'p-shared' })
    const depA = makeVersion({
      id: 'v-a',
      project_id: 'p-a',
      dependencies: [{ version_id: 'v-shared', project_id: null, file_name: null, dependency_type: 'required' }]
    })
    const depB = makeVersion({
      id: 'v-b',
      project_id: 'p-b',
      dependencies: [{ version_id: 'v-shared', project_id: null, file_name: null, dependency_type: 'required' }]
    })
    const root = makeVersion({
      dependencies: [
        { version_id: 'v-a', project_id: null, file_name: null, dependency_type: 'required' },
        { version_id: 'v-b', project_id: null, file_name: null, dependency_type: 'required' }
      ]
    })
    const versionsById: Record<string, ModrinthVersion> = { 'v-a': depA, 'v-b': depB, 'v-shared': shared }
    const plan = await resolveModInstallPlan(root, profile, new Set(), {
      getProjectVersions: async () => [],
      getVersion: async (id) => versionsById[id]
    })
    const projectIds = plan.toInstall.map((r) => r.version.project_id)
    expect(projectIds).toEqual(['project-root', 'p-a', 'p-b', 'p-shared'])
    expect(projectIds.filter((id) => id === 'p-shared')).toHaveLength(1)
  })

  it('does not infinite-loop on a dependency cycle', async () => {
    // depA requires depB, depB requires depA back.
    const depB: ModrinthVersion = makeVersion({
      id: 'v-b',
      project_id: 'p-b',
      dependencies: [{ version_id: 'v-a', project_id: null, file_name: null, dependency_type: 'required' }]
    })
    const depA: ModrinthVersion = makeVersion({
      id: 'v-a',
      project_id: 'p-a',
      dependencies: [{ version_id: 'v-b', project_id: null, file_name: null, dependency_type: 'required' }]
    })
    const root = makeVersion({
      dependencies: [{ version_id: 'v-a', project_id: null, file_name: null, dependency_type: 'required' }]
    })
    const versionsById: Record<string, ModrinthVersion> = { 'v-a': depA, 'v-b': depB }
    const plan = await resolveModInstallPlan(root, profile, new Set(), {
      getProjectVersions: async () => [],
      getVersion: async (id) => versionsById[id]
    })
    const projectIds = plan.toInstall.map((r) => r.version.project_id)
    expect(projectIds).toEqual(['project-root', 'p-a', 'p-b'])
  })
})
