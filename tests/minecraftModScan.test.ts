import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import type { MinecraftProfile } from '../shared/minecraft'
import type { InstalledMinecraftMod } from '../shared/minecraftMods'
import type { ModrinthVersion } from '../src/main/lib/modrinthClient'

const mockSaveMinecraftProfile = vi.fn((profile: MinecraftProfile) => [profile])
vi.mock('../src/main/store', () => ({
  saveMinecraftProfile: (profile: MinecraftProfile) => mockSaveMinecraftProfile(profile)
}))

vi.mock('../src/main/lib/managerLog', () => ({
  logManagerEvent: vi.fn(),
  newTaskId: (prefix: string) => `${prefix}-test`
}))

const mockGetModrinthVersionsFromHashes = vi.fn()
const mockGetModrinthProject = vi.fn()
vi.mock('../src/main/lib/modrinthClient', async () => {
  const actual = await vi.importActual<typeof import('../src/main/lib/modrinthClient')>('../src/main/lib/modrinthClient')
  return {
    ...actual,
    getModrinthVersionsFromHashes: (...args: unknown[]) => mockGetModrinthVersionsFromHashes(...args),
    getModrinthProject: (id: string) => mockGetModrinthProject(id)
  }
})

import { scanForInstalledMods, modTargetDir } from '../src/main/lib/minecraftMods'

function makeProfile(overrides: Partial<MinecraftProfile> = {}, installDir: string): MinecraftProfile {
  return {
    id: 'mc-mod-scan-test',
    name: 'Mod Scan Test Server',
    serverType: 'fabric',
    installDir,
    minecraftVersion: '',
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

function makeVersion(overrides: Partial<ModrinthVersion> = {}): ModrinthVersion {
  return {
    id: 'version-root',
    project_id: 'project-root',
    version_number: '1.0.0',
    game_versions: ['1.20.1'],
    loaders: ['fabric'],
    version_type: 'release',
    date_published: '2026-01-01T00:00:00Z',
    files: [],
    dependencies: [],
    ...overrides
  }
}

function sha1(content: string): string {
  return crypto.createHash('sha1').update(content).digest('hex')
}

describe('scanForInstalledMods', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-mods-scan-test-'))
    mockSaveMinecraftProfile.mockClear()
    mockGetModrinthVersionsFromHashes.mockReset()
    mockGetModrinthProject.mockReset()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('does not call the Modrinth API when the mods folder has nothing untracked', async () => {
    const profile = makeProfile({}, tmpDir)
    fs.mkdirSync(modTargetDir(profile), { recursive: true })

    const { result } = await scanForInstalledMods(profile)

    expect(result).toEqual({ adopted: [], unidentifiedCount: 0 })
    expect(mockGetModrinthVersionsFromHashes).not.toHaveBeenCalled()
    expect(mockSaveMinecraftProfile).not.toHaveBeenCalled()
  })

  it('works without a Minecraft version set - hash identification does not need it', async () => {
    const profile = makeProfile({ minecraftVersion: '' }, tmpDir)
    fs.mkdirSync(modTargetDir(profile), { recursive: true })
    fs.writeFileSync(path.join(modTargetDir(profile), 'found.jar'), 'content')
    const hash = sha1('content')
    mockGetModrinthVersionsFromHashes.mockResolvedValue({ [hash]: makeVersion() })
    mockGetModrinthProject.mockResolvedValue({
      id: 'project-root',
      slug: 'root-mod',
      title: 'Root Mod',
      description: '',
      icon_url: null,
      client_side: 'optional',
      server_side: 'required'
    })

    const { result } = await scanForInstalledMods(profile)

    expect(result.adopted).toHaveLength(1)
  })

  it('rejects for a server type with no mod/plugin ecosystem', async () => {
    const profile = makeProfile({ serverType: 'vanilla' }, tmpDir)
    await expect(scanForInstalledMods(profile)).rejects.toThrow(/mod\/plugin ecosystem/)
  })

  it('adopts an untracked jar whose hash matches a Modrinth version, into profile.installedMods', async () => {
    const profile = makeProfile({}, tmpDir)
    fs.mkdirSync(modTargetDir(profile), { recursive: true })
    fs.writeFileSync(path.join(modTargetDir(profile), 'root.jar'), 'root content')
    const hash = sha1('root content')
    mockGetModrinthVersionsFromHashes.mockResolvedValue({
      [hash]: makeVersion({ id: 'version-root', project_id: 'project-root', version_number: '1.0.0' })
    })
    mockGetModrinthProject.mockResolvedValue({
      id: 'project-root',
      slug: 'root-mod',
      title: 'Root Mod',
      description: '',
      icon_url: 'https://example.test/icon.png',
      client_side: 'optional',
      server_side: 'required'
    })

    const { profile: updated, result } = await scanForInstalledMods(profile)

    expect(result.adopted).toHaveLength(1)
    expect(result.adopted[0]).toMatchObject({
      projectId: 'project-root',
      fileName: 'root.jar',
      enabled: true,
      installedAs: 'user',
      versionId: 'version-root'
    })
    expect(result.unidentifiedCount).toBe(0)
    expect(updated.installedMods).toHaveLength(1)
    expect(mockSaveMinecraftProfile).toHaveBeenCalledTimes(1)
    expect(mockGetModrinthVersionsFromHashes).toHaveBeenCalledWith([hash], 'sha1')
  })

  it('skips files already tracked in profile.installedMods', async () => {
    const existing: InstalledMinecraftMod = {
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
    const profile = makeProfile({ installedMods: [existing] }, tmpDir)
    fs.mkdirSync(modTargetDir(profile), { recursive: true })
    fs.writeFileSync(path.join(modTargetDir(profile), 'root.jar'), 'root content')

    const { result } = await scanForInstalledMods(profile)

    expect(result).toEqual({ adopted: [], unidentifiedCount: 0 })
    expect(mockGetModrinthVersionsFromHashes).not.toHaveBeenCalled()
  })

  it('reports unidentified files without adopting them, and leaves the profile untouched', async () => {
    const profile = makeProfile({}, tmpDir)
    fs.mkdirSync(modTargetDir(profile), { recursive: true })
    fs.writeFileSync(path.join(modTargetDir(profile), 'mystery.jar'), 'unknown content')
    mockGetModrinthVersionsFromHashes.mockResolvedValue({})

    const { profile: updated, result } = await scanForInstalledMods(profile)

    expect(result.adopted).toHaveLength(0)
    expect(result.unidentifiedCount).toBe(1)
    expect(updated.installedMods).toHaveLength(0)
    expect(mockSaveMinecraftProfile).not.toHaveBeenCalled()
  })

  it('respects the .disabled suffix - a disabled file is adopted with enabled: false', async () => {
    const profile = makeProfile({}, tmpDir)
    fs.mkdirSync(modTargetDir(profile), { recursive: true })
    fs.writeFileSync(path.join(modTargetDir(profile), 'root.jar.disabled'), 'root content')
    const hash = sha1('root content')
    mockGetModrinthVersionsFromHashes.mockResolvedValue({ [hash]: makeVersion() })
    mockGetModrinthProject.mockResolvedValue({
      id: 'project-root',
      slug: 'root-mod',
      title: 'Root Mod',
      description: '',
      icon_url: null,
      client_side: 'optional',
      server_side: 'required'
    })

    const { result } = await scanForInstalledMods(profile)

    expect(result.adopted).toHaveLength(1)
    expect(result.adopted[0]).toMatchObject({ fileName: 'root.jar', enabled: false })
  })
})
