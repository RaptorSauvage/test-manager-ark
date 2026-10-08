import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { MinecraftProfile } from '../shared/minecraft'
import type { CurseForgeFile, CurseForgeMod } from '../src/main/lib/curseforgeClient'

const mockSaveMinecraftProfile = vi.fn((profile: MinecraftProfile) => [profile])
const mockGetSettings = vi.fn(() => ({ curseforgeApiKey: 'test-key' }))
vi.mock('../src/main/store', () => ({
  saveMinecraftProfile: (profile: MinecraftProfile) => mockSaveMinecraftProfile(profile),
  getSettings: () => mockGetSettings()
}))

vi.mock('../src/main/lib/managerLog', () => ({
  logManagerEvent: vi.fn(),
  newTaskId: (prefix: string) => `${prefix}-test`
}))

const mockSearchModrinthProjects = vi.fn(async () => [])
vi.mock('../src/main/lib/modrinthClient', async () => {
  const actual = await vi.importActual<typeof import('../src/main/lib/modrinthClient')>('../src/main/lib/modrinthClient')
  return {
    ...actual,
    searchModrinthProjects: (...args: unknown[]) => mockSearchModrinthProjects(...args)
  }
})

const mockSearchCurseForgeMods = vi.fn()
const mockGetCurseForgeMod = vi.fn()
const mockGetCurseForgeModFiles = vi.fn()
vi.mock('../src/main/lib/curseforgeClient', async () => {
  const actual = await vi.importActual<typeof import('../src/main/lib/curseforgeClient')>('../src/main/lib/curseforgeClient')
  return {
    ...actual,
    searchCurseForgeMods: (...args: unknown[]) => mockSearchCurseForgeMods(...args),
    getCurseForgeMod: (...args: unknown[]) => mockGetCurseForgeMod(...args),
    getCurseForgeModFiles: (...args: unknown[]) => mockGetCurseForgeModFiles(...args)
  }
})

import { searchMinecraftMods, installMinecraftMod, checkMinecraftModUpdates, modTargetDir } from '../src/main/lib/minecraftMods'

function makeProfile(overrides: Partial<MinecraftProfile> = {}, installDir: string): MinecraftProfile {
  return {
    id: 'mc-mod-cf-test',
    name: 'CurseForge Mod Test Server',
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

function makeMod(overrides: Partial<CurseForgeMod> = {}): CurseForgeMod {
  return {
    id: 100,
    slug: 'root-mod',
    name: 'Root Mod',
    summary: 'A root mod',
    downloadCount: 500,
    logo: { thumbnailUrl: 'https://example.test/icon.png' },
    allowModDistribution: true,
    ...overrides
  }
}

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

describe('minecraftMods - CurseForge', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-mods-cf-test-'))
    mockSaveMinecraftProfile.mockClear()
    mockGetSettings.mockReturnValue({ curseforgeApiKey: 'test-key' })
    mockSearchModrinthProjects.mockClear()
    mockSearchModrinthProjects.mockResolvedValue([])
    mockSearchCurseForgeMods.mockReset()
    mockGetCurseForgeMod.mockReset()
    mockGetCurseForgeMod.mockResolvedValue(makeMod())
    mockGetCurseForgeModFiles.mockReset()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    vi.unstubAllGlobals()
  })

  it('searchMinecraftMods merges Modrinth and CurseForge results, sorted by downloads', async () => {
    mockSearchModrinthProjects.mockResolvedValue([
      { project_id: 'p1', slug: 'low', title: 'Low Downloads', description: '', icon_url: null, downloads: 10, client_side: 'optional', server_side: 'required' }
    ])
    mockSearchCurseForgeMods.mockResolvedValue([makeMod({ id: 200, name: 'High Downloads', downloadCount: 9999 })])

    const profile = makeProfile({}, tmpDir)
    const results = await searchMinecraftMods(profile, 'query')

    expect(results).toHaveLength(2)
    expect(results[0].title).toBe('High Downloads')
    expect(results[0].source).toBe('curseforge')
    expect(results[1].title).toBe('Low Downloads')
  })

  it('searchMinecraftMods skips CurseForge entirely when no API key is set', async () => {
    mockGetSettings.mockReturnValue({ curseforgeApiKey: '' })
    mockSearchModrinthProjects.mockResolvedValue([])

    const profile = makeProfile({}, tmpDir)
    await searchMinecraftMods(profile, 'query')

    expect(mockSearchCurseForgeMods).not.toHaveBeenCalled()
  })

  it('searchMinecraftMods falls back to Modrinth-only results when CurseForge search fails', async () => {
    mockSearchModrinthProjects.mockResolvedValue([
      { project_id: 'p1', slug: 'ok', title: 'OK Mod', description: '', icon_url: null, downloads: 10, client_side: 'optional', server_side: 'required' }
    ])
    mockSearchCurseForgeMods.mockRejectedValue(new Error('CurseForge is down'))

    const profile = makeProfile({}, tmpDir)
    const results = await searchMinecraftMods(profile, 'query')

    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('OK Mod')
  })

  it('searchMinecraftMods excludes CurseForge mods that disallow third-party distribution', async () => {
    mockSearchCurseForgeMods.mockResolvedValue([makeMod({ allowModDistribution: false })])

    const profile = makeProfile({}, tmpDir)
    const results = await searchMinecraftMods(profile, 'query')

    expect(results).toHaveLength(0)
  })

  it('installs a CurseForge mod with no dependencies - downloads the file into mods/ and updates the profile', async () => {
    mockGetCurseForgeModFiles.mockResolvedValue([makeFile()])
    vi.stubGlobal('fetch', vi.fn(async () => fakeFetchResponse(Buffer.from('fake jar content'))))

    const profile = makeProfile({}, tmpDir)
    const { profile: updated, result } = await installMinecraftMod(profile, 'curseforge', '100')

    expect(fs.readFileSync(path.join(modTargetDir(profile), 'root.jar')).toString()).toBe('fake jar content')
    expect(updated.installedMods).toHaveLength(1)
    expect(updated.installedMods[0]).toMatchObject({
      source: 'curseforge',
      projectId: '100',
      title: 'Root Mod',
      fileName: 'root.jar',
      enabled: true
    })
    expect(result.installed).toHaveLength(1)
    expect(mockSaveMinecraftProfile).toHaveBeenCalledTimes(1)
  })

  it('rejects installing a CurseForge mod when no compatible file exists', async () => {
    mockGetCurseForgeModFiles.mockResolvedValue([])
    const profile = makeProfile({}, tmpDir)
    await expect(installMinecraftMod(profile, 'curseforge', '100')).rejects.toThrow(/compatible/)
  })

  it('rejects installing a CurseForge mod when no API key is configured', async () => {
    mockGetSettings.mockReturnValue({ curseforgeApiKey: '' })
    const profile = makeProfile({}, tmpDir)
    await expect(installMinecraftMod(profile, 'curseforge', '100')).rejects.toThrow(/API key/)
  })

  it('rejects downloading a file whose author disabled third-party distribution', async () => {
    mockGetCurseForgeModFiles.mockResolvedValue([makeFile({ downloadUrl: null })])
    const profile = makeProfile({}, tmpDir)
    await expect(installMinecraftMod(profile, 'curseforge', '100')).rejects.toThrow(/third-party distribution/)
  })

  it('installs a required CurseForge dependency alongside the requested mod', async () => {
    const depFile = makeFile({ id: 2, modId: 200, fileName: 'dep.jar' })
    const rootFile = makeFile({ dependencies: [{ modId: 200, relationType: 3 }] })
    mockGetCurseForgeModFiles.mockImplementation(async (_apiKey: string, modId: number) => (modId === 100 ? [rootFile] : [depFile]))
    mockGetCurseForgeMod.mockImplementation(async (_apiKey: string, modId: number) =>
      makeMod({ id: modId, name: modId === 100 ? 'Root Mod' : 'Dep Mod' })
    )
    vi.stubGlobal('fetch', vi.fn(async () => fakeFetchResponse(Buffer.from('x'))))

    const profile = makeProfile({}, tmpDir)
    const { profile: updated, result } = await installMinecraftMod(profile, 'curseforge', '100')

    expect(updated.installedMods.map((m) => m.projectId).sort()).toEqual(['100', '200'])
    expect(result.dependenciesInstalled).toHaveLength(1)
  })

  it('checkMinecraftModUpdates flags a CurseForge mod whose latest file id differs from the installed one', async () => {
    const entry = {
      source: 'curseforge' as const,
      projectId: '100',
      slug: 'root-mod',
      title: 'Root Mod',
      versionId: '1',
      versionNumber: '1.0.0',
      fileName: 'root.jar',
      enabled: true,
      installedAs: 'user' as const,
      installedAt: Date.now()
    }
    const profile = makeProfile({ installedMods: [entry] }, tmpDir)
    mockGetCurseForgeModFiles.mockResolvedValue([makeFile({ id: 2, displayName: '2.0.0' })])

    const [status] = await checkMinecraftModUpdates(profile)
    expect(status).toEqual({
      projectId: '100',
      updateAvailable: true,
      latestVersionId: '2',
      latestVersionNumber: '2.0.0'
    })
  })

  it('checkMinecraftModUpdates skips a CurseForge entry when no API key is configured', async () => {
    mockGetSettings.mockReturnValue({ curseforgeApiKey: '' })
    const entry = {
      source: 'curseforge' as const,
      projectId: '100',
      slug: 'root-mod',
      title: 'Root Mod',
      versionId: '1',
      versionNumber: '1.0.0',
      fileName: 'root.jar',
      enabled: true,
      installedAs: 'user' as const,
      installedAt: Date.now()
    }
    const profile = makeProfile({ installedMods: [entry] }, tmpDir)

    const results = await checkMinecraftModUpdates(profile)
    expect(results).toEqual([])
    expect(mockGetCurseForgeModFiles).not.toHaveBeenCalled()
  })
})
