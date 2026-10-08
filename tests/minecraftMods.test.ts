import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import type { MinecraftProfile } from '../shared/minecraft'
import type { ModrinthVersion } from '../src/main/lib/modrinthClient'

const mockSaveMinecraftProfile = vi.fn((profile: MinecraftProfile) => [profile])
const mockGetSettings = vi.fn(() => ({ curseforgeApiKey: '' }))
vi.mock('../src/main/store', () => ({
  saveMinecraftProfile: (profile: MinecraftProfile) => mockSaveMinecraftProfile(profile),
  getSettings: () => mockGetSettings()
}))

vi.mock('../src/main/lib/managerLog', () => ({
  logManagerEvent: vi.fn(),
  newTaskId: (prefix: string) => `${prefix}-test`
}))

const mockGetModrinthProjectVersions = vi.fn<[string, string, string], Promise<ModrinthVersion[]>>()
const mockGetModrinthVersion = vi.fn<[string], Promise<ModrinthVersion>>()
const mockGetModrinthProject = vi.fn()
const mockSearchModrinthProjects = vi.fn()
vi.mock('../src/main/lib/modrinthClient', async () => {
  const actual = await vi.importActual<typeof import('../src/main/lib/modrinthClient')>('../src/main/lib/modrinthClient')
  return {
    ...actual,
    getModrinthProjectVersions: (...args: [string, string, string]) => mockGetModrinthProjectVersions(...args),
    getModrinthVersion: (id: string) => mockGetModrinthVersion(id),
    getModrinthProject: (id: string) => mockGetModrinthProject(id),
    searchModrinthProjects: (...args: unknown[]) => mockSearchModrinthProjects(...args)
  }
})

import {
  installMinecraftMod,
  removeMinecraftMod,
  setMinecraftModEnabled,
  checkMinecraftModUpdates,
  modTargetDir
} from '../src/main/lib/minecraftMods'

function makeProfile(overrides: Partial<MinecraftProfile> = {}, installDir: string): MinecraftProfile {
  return {
    id: 'mc-mod-test',
    name: 'Mod Test Server',
    serverType: 'fabric',
    installDir,
    minecraftVersion: '1.20.1',
    launchMode: 'jar',
    jarFileName: 'server.jar',
    scriptFileName: '',
    minMemoryMB: 1024,
    maxMemoryMB: 2048,
    extraJvmArgs: '',
    extraProgramArgs: '',
    hidden: false,
    group: '',
    startOnManagerLaunch: false,
    scheduledRestartEnabled: false,
    scheduledRestartTime: '00:00',
    scheduledRestartDays: [],
    scheduledRestartStartAfter: true,
    backupDir: '',
    maxBackups: 10,
    backupScheduleEnabled: false,
    installedMods: [],
    ...overrides
  }
}

function makeProject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'project-root',
    slug: 'root-mod',
    title: 'Root Mod',
    description: 'A root mod',
    icon_url: null,
    client_side: 'optional',
    server_side: 'required',
    ...overrides
  }
}

function makeVersion(overrides: Partial<ModrinthVersion> = {}): ModrinthVersion {
  return {
    id: 'version-root',
    project_id: 'project-root',
    version_number: '1.0.0',
    game_versions: ['1.20.1'],
    loaders: ['fabric'],
    version_type: 'release',
    date_published: '2026-01-01T00:00:00Z',
    files: [
      {
        hashes: {},
        url: 'https://example.test/root.jar',
        filename: 'root.jar',
        primary: true,
        size: 100
      }
    ],
    dependencies: [],
    ...overrides
  }
}

function fakeFetchResponse(body: Buffer, ok = true, status = 200): Response {
  return {
    ok,
    status,
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
  } as unknown as Response
}

describe('minecraftMods', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-mods-test-'))
    mockSaveMinecraftProfile.mockClear()
    mockGetModrinthProjectVersions.mockReset()
    mockGetModrinthVersion.mockReset()
    mockGetModrinthProject.mockReset()
    mockGetModrinthProject.mockImplementation(async (id: string) => makeProject({ id, slug: id, title: id }))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    vi.unstubAllGlobals()
  })

  it('installs a mod with no dependencies - downloads the file into mods/ and updates the profile', async () => {
    const fileContent = Buffer.from('fake jar content')
    mockGetModrinthProjectVersions.mockResolvedValue([makeVersion()])
    vi.stubGlobal('fetch', vi.fn(async () => fakeFetchResponse(fileContent)))

    const profile = makeProfile({}, tmpDir)
    const { profile: updated, result } = await installMinecraftMod(profile, 'modrinth', 'project-root')

    expect(fs.readFileSync(path.join(modTargetDir(profile), 'root.jar'))).toEqual(fileContent)
    expect(updated.installedMods).toHaveLength(1)
    expect(updated.installedMods[0]).toMatchObject({ projectId: 'project-root', fileName: 'root.jar', enabled: true, installedAs: 'user' })
    expect(result.installed).toHaveLength(1)
    expect(result.dependenciesInstalled).toHaveLength(0)
    expect(mockSaveMinecraftProfile).toHaveBeenCalledTimes(1)
  })

  it('uses the plugins/ folder for Paper/Spigot instead of mods/', () => {
    const profile = makeProfile({ serverType: 'paper' }, tmpDir)
    expect(modTargetDir(profile)).toBe(path.join(tmpDir, 'plugins'))
  })

  it('rejects when no version is compatible with this server', async () => {
    mockGetModrinthProjectVersions.mockResolvedValue([])
    const profile = makeProfile({}, tmpDir)
    await expect(installMinecraftMod(profile, 'modrinth', 'project-root')).rejects.toThrow(/compatible/)
    expect(mockSaveMinecraftProfile).not.toHaveBeenCalled()
  })

  it('rejects for a server type with no mod ecosystem', async () => {
    const profile = makeProfile({ serverType: 'vanilla' }, tmpDir)
    await expect(installMinecraftMod(profile, 'modrinth', 'project-root')).rejects.toThrow(/mod\/plugin ecosystem/)
  })

  it('rejects when the Minecraft version is not set', async () => {
    const profile = makeProfile({ minecraftVersion: '' }, tmpDir)
    await expect(installMinecraftMod(profile, 'modrinth', 'project-root')).rejects.toThrow(/Minecraft version/)
  })

  it('installs a required dependency alongside the requested mod', async () => {
    const depVersion = makeVersion({ id: 'version-dep', project_id: 'project-dep', files: [{ hashes: {}, url: 'https://example.test/dep.jar', filename: 'dep.jar', primary: true, size: 50 }] })
    const rootVersion = makeVersion({
      dependencies: [{ version_id: 'version-dep', project_id: null, file_name: null, dependency_type: 'required' }]
    })
    mockGetModrinthProjectVersions.mockResolvedValue([rootVersion])
    mockGetModrinthVersion.mockResolvedValue(depVersion)
    vi.stubGlobal('fetch', vi.fn(async () => fakeFetchResponse(Buffer.from('x'))))

    const profile = makeProfile({}, tmpDir)
    const { profile: updated, result } = await installMinecraftMod(profile, 'modrinth', 'project-root')

    expect(updated.installedMods.map((m) => m.projectId).sort()).toEqual(['project-dep', 'project-root'])
    expect(result.dependenciesInstalled).toHaveLength(1)
    expect(fs.existsSync(path.join(modTargetDir(profile), 'dep.jar'))).toBe(true)
  })

  it('discards a downloaded file that fails its published hash', async () => {
    const badContent = Buffer.from('tampered content')
    const version = makeVersion({
      files: [
        {
          hashes: { sha512: crypto.createHash('sha512').update('expected content').digest('hex') },
          url: 'https://example.test/root.jar',
          filename: 'root.jar',
          primary: true,
          size: 100
        }
      ]
    })
    mockGetModrinthProjectVersions.mockResolvedValue([version])
    vi.stubGlobal('fetch', vi.fn(async () => fakeFetchResponse(badContent)))

    const profile = makeProfile({}, tmpDir)
    await expect(installMinecraftMod(profile, 'modrinth', 'project-root')).rejects.toThrow(/checksum/)
    expect(fs.existsSync(path.join(modTargetDir(profile), 'root.jar'))).toBe(false)
  })

  it('removeMinecraftMod deletes the file and drops the profile entry', () => {
    const profile = makeProfile(
      {
        installedMods: [
          {
            source: 'modrinth',
            projectId: 'project-root',
            slug: 'root-mod',
            title: 'Root Mod',
            versionId: 'version-root',
            versionNumber: '1.0.0',
            fileName: 'root.jar',
            enabled: true,
            installedAs: 'user',
            installedAt: Date.now()
          }
        ]
      },
      tmpDir
    )
    fs.mkdirSync(modTargetDir(profile), { recursive: true })
    fs.writeFileSync(path.join(modTargetDir(profile), 'root.jar'), 'content')

    const updated = removeMinecraftMod(profile, 'project-root')

    expect(updated.installedMods).toHaveLength(0)
    expect(fs.existsSync(path.join(modTargetDir(profile), 'root.jar'))).toBe(false)
    expect(mockSaveMinecraftProfile).toHaveBeenCalledTimes(1)
  })

  it('setMinecraftModEnabled(false) renames the file to add .disabled, and back when re-enabled', () => {
    const entry = {
      source: 'modrinth' as const,
      projectId: 'project-root',
      slug: 'root-mod',
      title: 'Root Mod',
      versionId: 'version-root',
      versionNumber: '1.0.0',
      fileName: 'root.jar',
      enabled: true,
      installedAs: 'user' as const,
      installedAt: Date.now()
    }
    const profile = makeProfile({ installedMods: [entry] }, tmpDir)
    fs.mkdirSync(modTargetDir(profile), { recursive: true })
    fs.writeFileSync(path.join(modTargetDir(profile), 'root.jar'), 'content')

    const disabled = setMinecraftModEnabled(profile, 'project-root', false)
    expect(disabled.installedMods[0].enabled).toBe(false)
    expect(fs.existsSync(path.join(modTargetDir(profile), 'root.jar'))).toBe(false)
    expect(fs.existsSync(path.join(modTargetDir(profile), 'root.jar.disabled'))).toBe(true)

    const reEnabled = setMinecraftModEnabled(disabled, 'project-root', true)
    expect(reEnabled.installedMods[0].enabled).toBe(true)
    expect(fs.existsSync(path.join(modTargetDir(profile), 'root.jar'))).toBe(true)
    expect(fs.existsSync(path.join(modTargetDir(profile), 'root.jar.disabled'))).toBe(false)
  })

  it('checkMinecraftModUpdates flags a mod whose latest compatible version id differs from the installed one', async () => {
    const entry = {
      source: 'modrinth' as const,
      projectId: 'project-root',
      slug: 'root-mod',
      title: 'Root Mod',
      versionId: 'version-old',
      versionNumber: '0.9.0',
      fileName: 'root.jar',
      enabled: true,
      installedAs: 'user' as const,
      installedAt: Date.now()
    }
    const profile = makeProfile({ installedMods: [entry] }, tmpDir)
    mockGetModrinthProjectVersions.mockResolvedValue([makeVersion({ id: 'version-new', version_number: '1.1.0' })])

    const [status] = await checkMinecraftModUpdates(profile)
    expect(status).toEqual({
      projectId: 'project-root',
      updateAvailable: true,
      latestVersionId: 'version-new',
      latestVersionNumber: '1.1.0'
    })
  })

  it('checkMinecraftModUpdates reports no update when the latest version matches what is installed', async () => {
    const entry = {
      source: 'modrinth' as const,
      projectId: 'project-root',
      slug: 'root-mod',
      title: 'Root Mod',
      versionId: 'version-root',
      versionNumber: '1.0.0',
      fileName: 'root.jar',
      enabled: true,
      installedAs: 'user' as const,
      installedAt: Date.now()
    }
    const profile = makeProfile({ installedMods: [entry] }, tmpDir)
    mockGetModrinthProjectVersions.mockResolvedValue([makeVersion()])

    const [status] = await checkMinecraftModUpdates(profile)
    expect(status.updateAvailable).toBe(false)
  })

  it('checkMinecraftModUpdates skips source: "unknown" entries - no real Modrinth project id to check', async () => {
    const known = {
      source: 'modrinth' as const,
      projectId: 'project-root',
      slug: 'root-mod',
      title: 'Root Mod',
      versionId: 'version-root',
      versionNumber: '1.0.0',
      fileName: 'root.jar',
      enabled: true,
      installedAs: 'user' as const,
      installedAt: Date.now()
    }
    const unknown = {
      source: 'unknown' as const,
      projectId: 'local:mystery.jar',
      slug: 'mystery',
      title: 'mystery',
      versionId: '',
      versionNumber: '',
      fileName: 'mystery.jar',
      enabled: true,
      installedAs: 'user' as const,
      installedAt: Date.now()
    }
    const profile = makeProfile({ installedMods: [known, unknown] }, tmpDir)
    mockGetModrinthProjectVersions.mockResolvedValue([makeVersion()])

    const results = await checkMinecraftModUpdates(profile)

    expect(results).toHaveLength(1)
    expect(results[0].projectId).toBe('project-root')
    expect(mockGetModrinthProjectVersions).toHaveBeenCalledTimes(1)
  })
})
