import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import type { MinecraftProfile } from '../shared/minecraft'
import type { InstalledMinecraftMod } from '../shared/minecraftMods'
import type { ModrinthVersion } from '../src/main/lib/modrinthClient'

const mockOpenPath = vi.fn(async () => '')
vi.mock('electron', () => ({ shell: { openPath: (p: string) => mockOpenPath(p) } }))

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

const mockGetModrinthVersionsFromHashes = vi.fn()
const mockGetModrinthProjects = vi.fn()
vi.mock('../src/main/lib/modrinthClient', async () => {
  const actual = await vi.importActual<typeof import('../src/main/lib/modrinthClient')>('../src/main/lib/modrinthClient')
  return {
    ...actual,
    getModrinthVersionsFromHashes: (...args: unknown[]) => mockGetModrinthVersionsFromHashes(...args),
    getModrinthProjects: (ids: string[]) => mockGetModrinthProjects(ids)
  }
})

const mockGetCurseForgeFingerprintMatches = vi.fn()
const mockGetCurseForgeMods = vi.fn()
vi.mock('../src/main/lib/curseforgeClient', async () => {
  const actual = await vi.importActual<typeof import('../src/main/lib/curseforgeClient')>('../src/main/lib/curseforgeClient')
  return {
    ...actual,
    getCurseForgeFingerprintMatches: (...args: unknown[]) => mockGetCurseForgeFingerprintMatches(...args),
    getCurseForgeMods: (...args: unknown[]) => mockGetCurseForgeMods(...args)
  }
})

import { scanForInstalledMods, openMinecraftModsFolder, modTargetDir } from '../src/main/lib/minecraftMods'
import { computeCurseForgeFingerprint } from '../src/main/lib/curseforgeFingerprint'

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
    mockGetModrinthProjects.mockReset()
    mockGetModrinthProjects.mockResolvedValue([])
    mockGetSettings.mockReturnValue({ curseforgeApiKey: '' })
    mockGetCurseForgeFingerprintMatches.mockReset()
    mockGetCurseForgeMods.mockReset()
    mockOpenPath.mockClear()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('does not call the Modrinth API when the mods folder has nothing untracked', async () => {
    const profile = makeProfile({}, tmpDir)
    fs.mkdirSync(modTargetDir(profile), { recursive: true })

    const { result } = await scanForInstalledMods(profile)

    expect(result).toEqual({ adopted: [] })
    expect(mockGetModrinthVersionsFromHashes).not.toHaveBeenCalled()
    expect(mockSaveMinecraftProfile).not.toHaveBeenCalled()
  })

  it('works without a Minecraft version set - hash identification does not need it', async () => {
    const profile = makeProfile({ minecraftVersion: '' }, tmpDir)
    fs.mkdirSync(modTargetDir(profile), { recursive: true })
    fs.writeFileSync(path.join(modTargetDir(profile), 'found.jar'), 'content')
    const hash = sha1('content')
    mockGetModrinthVersionsFromHashes.mockResolvedValue({ [hash]: makeVersion() })
    mockGetModrinthProjects.mockResolvedValue([
      {
        id: 'project-root',
        slug: 'root-mod',
        title: 'Root Mod',
        description: '',
        icon_url: null,
        client_side: 'optional',
        server_side: 'required'
      }
    ])

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
    mockGetModrinthProjects.mockResolvedValue([
      {
        id: 'project-root',
        slug: 'root-mod',
        title: 'Root Mod',
        description: '',
        icon_url: 'https://example.test/icon.png',
        client_side: 'optional',
        server_side: 'required'
      }
    ])

    const { profile: updated, result } = await scanForInstalledMods(profile)

    expect(result.adopted).toHaveLength(1)
    expect(result.adopted[0]).toMatchObject({
      projectId: 'project-root',
      fileName: 'root.jar',
      enabled: true,
      installedAs: 'user',
      versionId: 'version-root'
    })
    expect(updated.installedMods).toHaveLength(1)
    expect(mockSaveMinecraftProfile).toHaveBeenCalledTimes(1)
    expect(mockGetModrinthVersionsFromHashes).toHaveBeenCalledWith([hash], 'sha1')
    expect(mockGetModrinthProjects).toHaveBeenCalledWith(['project-root'])
  })

  it('batches the project lookup into one call, deduplicated, even for several matched mods', async () => {
    const profile = makeProfile({}, tmpDir)
    fs.mkdirSync(modTargetDir(profile), { recursive: true })
    fs.writeFileSync(path.join(modTargetDir(profile), 'a.jar'), 'content a')
    fs.writeFileSync(path.join(modTargetDir(profile), 'b.jar'), 'content b')
    const hashA = sha1('content a')
    const hashB = sha1('content b')
    mockGetModrinthVersionsFromHashes.mockResolvedValue({
      [hashA]: makeVersion({ id: 'version-a', project_id: 'project-a' }),
      [hashB]: makeVersion({ id: 'version-b', project_id: 'project-a' })
    })
    mockGetModrinthProjects.mockResolvedValue([
      { id: 'project-a', slug: 'mod-a', title: 'Mod A', description: '', icon_url: null, client_side: 'optional', server_side: 'required' }
    ])

    const { result } = await scanForInstalledMods(profile)

    expect(result.adopted).toHaveLength(2)
    expect(mockGetModrinthProjects).toHaveBeenCalledTimes(1)
    expect(mockGetModrinthProjects).toHaveBeenCalledWith(['project-a'])
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

    expect(result).toEqual({ adopted: [] })
    expect(mockGetModrinthVersionsFromHashes).not.toHaveBeenCalled()
  })

  it('adopts an unidentified file as source: "unknown" instead of leaving it untracked', async () => {
    const profile = makeProfile({}, tmpDir)
    fs.mkdirSync(modTargetDir(profile), { recursive: true })
    fs.writeFileSync(path.join(modTargetDir(profile), 'mystery.jar'), 'unknown content')
    mockGetModrinthVersionsFromHashes.mockResolvedValue({})

    const { profile: updated, result } = await scanForInstalledMods(profile)

    expect(result.adopted).toHaveLength(1)
    expect(result.adopted[0]).toMatchObject({
      source: 'unknown',
      projectId: 'local:mystery.jar',
      title: 'mystery',
      fileName: 'mystery.jar',
      enabled: true,
      versionId: '',
      versionNumber: ''
    })
    expect(updated.installedMods).toHaveLength(1)
    expect(mockSaveMinecraftProfile).toHaveBeenCalledTimes(1)
  })

  it('mixes identified and unidentified files in the same scan, each tagged correctly', async () => {
    const profile = makeProfile({}, tmpDir)
    fs.mkdirSync(modTargetDir(profile), { recursive: true })
    fs.writeFileSync(path.join(modTargetDir(profile), 'root.jar'), 'root content')
    fs.writeFileSync(path.join(modTargetDir(profile), 'mystery.jar'), 'unknown content')
    const hash = sha1('root content')
    mockGetModrinthVersionsFromHashes.mockResolvedValue({
      [hash]: makeVersion({ id: 'version-root', project_id: 'project-root' })
    })
    mockGetModrinthProjects.mockResolvedValue([
      { id: 'project-root', slug: 'root-mod', title: 'Root Mod', description: '', icon_url: null, client_side: 'optional', server_side: 'required' }
    ])

    const { result } = await scanForInstalledMods(profile)

    expect(result.adopted).toHaveLength(2)
    const byFileName = Object.fromEntries(result.adopted.map((m) => [m.fileName, m]))
    expect(byFileName['root.jar']).toMatchObject({ source: 'modrinth', title: 'Root Mod' })
    expect(byFileName['mystery.jar']).toMatchObject({ source: 'unknown', title: 'mystery' })
  })

  it('respects the .disabled suffix - a disabled file is adopted with enabled: false', async () => {
    const profile = makeProfile({}, tmpDir)
    fs.mkdirSync(modTargetDir(profile), { recursive: true })
    fs.writeFileSync(path.join(modTargetDir(profile), 'root.jar.disabled'), 'root content')
    const hash = sha1('root content')
    mockGetModrinthVersionsFromHashes.mockResolvedValue({ [hash]: makeVersion() })
    mockGetModrinthProjects.mockResolvedValue([
      {
        id: 'project-root',
        slug: 'root-mod',
        title: 'Root Mod',
        description: '',
        icon_url: null,
        client_side: 'optional',
        server_side: 'required'
      }
    ])

    const { result } = await scanForInstalledMods(profile)

    expect(result.adopted).toHaveLength(1)
    expect(result.adopted[0]).toMatchObject({ fileName: 'root.jar', enabled: false })
  })

  it('does not call CurseForge when no API key is configured - unmatched files just fall back to "unknown"', async () => {
    const profile = makeProfile({}, tmpDir)
    fs.mkdirSync(modTargetDir(profile), { recursive: true })
    fs.writeFileSync(path.join(modTargetDir(profile), 'mystery.jar'), 'unknown content')
    mockGetModrinthVersionsFromHashes.mockResolvedValue({})

    const { result } = await scanForInstalledMods(profile)

    expect(result.adopted).toHaveLength(1)
    expect(result.adopted[0].source).toBe('unknown')
    expect(mockGetCurseForgeFingerprintMatches).not.toHaveBeenCalled()
  })

  it('identifies a file Modrinth missed via a CurseForge fingerprint match, when an API key is set', async () => {
    const profile = makeProfile({}, tmpDir)
    fs.mkdirSync(modTargetDir(profile), { recursive: true })
    fs.writeFileSync(path.join(modTargetDir(profile), 'cf-mod.jar'), 'curseforge content')
    mockGetSettings.mockReturnValue({ curseforgeApiKey: 'test-key' })
    mockGetModrinthVersionsFromHashes.mockResolvedValue({})
    const fingerprint = computeCurseForgeFingerprint(Buffer.from('curseforge content'))
    mockGetCurseForgeFingerprintMatches.mockResolvedValue([
      {
        id: 200,
        file: { id: 55, modId: 200, fileName: 'cf-mod.jar', displayName: '2.0.0', fileFingerprint: fingerprint }
      }
    ])
    mockGetCurseForgeMods.mockResolvedValue([
      { id: 200, slug: 'cf-mod', name: 'CF Mod', summary: '', downloadCount: 10, logo: null, allowModDistribution: true }
    ])

    const { profile: updated, result } = await scanForInstalledMods(profile)

    expect(result.adopted).toHaveLength(1)
    expect(result.adopted[0]).toMatchObject({
      source: 'curseforge',
      projectId: '200',
      title: 'CF Mod',
      fileName: 'cf-mod.jar',
      versionId: '55',
      versionNumber: '2.0.0'
    })
    expect(updated.installedMods).toHaveLength(1)
    expect(mockGetCurseForgeFingerprintMatches).toHaveBeenCalledWith('test-key', [fingerprint])
  })

  it('sends CurseForge fingerprints for every untracked file, including ones Modrinth already matched - to detect cross-listing', async () => {
    const profile = makeProfile({}, tmpDir)
    fs.mkdirSync(modTargetDir(profile), { recursive: true })
    fs.writeFileSync(path.join(modTargetDir(profile), 'root.jar'), 'root content')
    fs.writeFileSync(path.join(modTargetDir(profile), 'cf-mod.jar'), 'curseforge content')
    mockGetSettings.mockReturnValue({ curseforgeApiKey: 'test-key' })
    const modrinthHash = sha1('root content')
    mockGetModrinthVersionsFromHashes.mockResolvedValue({
      [modrinthHash]: makeVersion({ id: 'version-root', project_id: 'project-root' })
    })
    mockGetModrinthProjects.mockResolvedValue([
      { id: 'project-root', slug: 'root-mod', title: 'Root Mod', description: '', icon_url: null, client_side: 'optional', server_side: 'required' }
    ])
    mockGetCurseForgeFingerprintMatches.mockResolvedValue([])

    await scanForInstalledMods(profile)

    const rootFingerprint = computeCurseForgeFingerprint(Buffer.from('root content'))
    const cfFingerprint = computeCurseForgeFingerprint(Buffer.from('curseforge content'))
    const sentFingerprints = mockGetCurseForgeFingerprintMatches.mock.calls[0][1] as number[]
    expect(sentFingerprints.sort()).toEqual([rootFingerprint, cfFingerprint].sort())
  })

  it('marks a file matched by both sources as cross-listed (alsoOn), keeping Modrinth as the primary source', async () => {
    const profile = makeProfile({}, tmpDir)
    fs.mkdirSync(modTargetDir(profile), { recursive: true })
    fs.writeFileSync(path.join(modTargetDir(profile), 'dual.jar'), 'dual content')
    mockGetSettings.mockReturnValue({ curseforgeApiKey: 'test-key' })
    const hash = sha1('dual content')
    mockGetModrinthVersionsFromHashes.mockResolvedValue({
      [hash]: makeVersion({ id: 'version-root', project_id: 'project-root' })
    })
    mockGetModrinthProjects.mockResolvedValue([
      { id: 'project-root', slug: 'root-mod', title: 'Root Mod', description: '', icon_url: null, client_side: 'optional', server_side: 'required' }
    ])
    const fingerprint = computeCurseForgeFingerprint(Buffer.from('dual content'))
    mockGetCurseForgeFingerprintMatches.mockResolvedValue([
      {
        id: 200,
        file: { id: 55, modId: 200, fileName: 'dual.jar', displayName: '2.0.0', fileFingerprint: fingerprint }
      }
    ])
    mockGetCurseForgeMods.mockResolvedValue([
      { id: 200, slug: 'cf-mod', name: 'CF Mod', summary: '', downloadCount: 10, logo: null, allowModDistribution: true }
    ])

    const { result } = await scanForInstalledMods(profile)

    expect(result.adopted).toHaveLength(1)
    expect(result.adopted[0]).toMatchObject({ source: 'modrinth', title: 'Root Mod', alsoOn: ['curseforge'] })
  })

  it('falls back to "unknown" when CurseForge finds no fingerprint match either', async () => {
    const profile = makeProfile({}, tmpDir)
    fs.mkdirSync(modTargetDir(profile), { recursive: true })
    fs.writeFileSync(path.join(modTargetDir(profile), 'mystery.jar'), 'unknown content')
    mockGetSettings.mockReturnValue({ curseforgeApiKey: 'test-key' })
    mockGetModrinthVersionsFromHashes.mockResolvedValue({})
    mockGetCurseForgeFingerprintMatches.mockResolvedValue([])

    const { result } = await scanForInstalledMods(profile)

    expect(result.adopted).toHaveLength(1)
    expect(result.adopted[0].source).toBe('unknown')
  })

  it('still adopts the Modrinth-matched files even if the CurseForge fingerprint check itself fails', async () => {
    const profile = makeProfile({}, tmpDir)
    fs.mkdirSync(modTargetDir(profile), { recursive: true })
    fs.writeFileSync(path.join(modTargetDir(profile), 'root.jar'), 'root content')
    fs.writeFileSync(path.join(modTargetDir(profile), 'mystery.jar'), 'unknown content')
    mockGetSettings.mockReturnValue({ curseforgeApiKey: 'test-key' })
    const modrinthHash = sha1('root content')
    mockGetModrinthVersionsFromHashes.mockResolvedValue({
      [modrinthHash]: makeVersion({ id: 'version-root', project_id: 'project-root' })
    })
    mockGetModrinthProjects.mockResolvedValue([
      { id: 'project-root', slug: 'root-mod', title: 'Root Mod', description: '', icon_url: null, client_side: 'optional', server_side: 'required' }
    ])
    mockGetCurseForgeFingerprintMatches.mockRejectedValue(new Error('CurseForge is down'))

    const { result } = await scanForInstalledMods(profile)

    expect(result.adopted).toHaveLength(2)
    const byFileName = Object.fromEntries(result.adopted.map((m) => [m.fileName, m]))
    expect(byFileName['root.jar'].source).toBe('modrinth')
    expect(byFileName['mystery.jar'].source).toBe('unknown')
  })

  it('re-examines a file previously adopted as "unknown", instead of leaving it unidentified forever', async () => {
    // Regression test: a file scanned back when only Modrinth hash-matching existed (or before
    // a CurseForge key was configured) got adopted as source: 'unknown' - and, being tracked,
    // was then silently excluded from every future scan, even after this app gained the
    // ability to recognize it. A real user report: searching for the mod by name in the
    // Browse tab found it on CurseForge, but repeated "Rescan folder" clicks never picked it
    // up, because it was already "tracked" as unknown.
    const existingUnknown: InstalledMinecraftMod = {
      source: 'unknown',
      projectId: 'local:cf-mod.jar',
      slug: 'cf-mod',
      title: 'cf-mod',
      versionId: '',
      versionNumber: '',
      fileName: 'cf-mod.jar',
      enabled: true,
      installedAs: 'user',
      installedAt: Date.now()
    }
    const profile = makeProfile({ installedMods: [existingUnknown] }, tmpDir)
    fs.mkdirSync(modTargetDir(profile), { recursive: true })
    fs.writeFileSync(path.join(modTargetDir(profile), 'cf-mod.jar'), 'curseforge content')
    mockGetSettings.mockReturnValue({ curseforgeApiKey: 'test-key' })
    mockGetModrinthVersionsFromHashes.mockResolvedValue({})
    const fingerprint = computeCurseForgeFingerprint(Buffer.from('curseforge content'))
    mockGetCurseForgeFingerprintMatches.mockResolvedValue([
      {
        id: 200,
        file: { id: 55, modId: 200, fileName: 'cf-mod.jar', displayName: '2.0.0', fileFingerprint: fingerprint }
      }
    ])
    mockGetCurseForgeMods.mockResolvedValue([
      { id: 200, slug: 'cf-mod', name: 'CF Mod', summary: '', downloadCount: 10, logo: null, allowModDistribution: true }
    ])

    const { profile: updated, result } = await scanForInstalledMods(profile)

    expect(result.adopted).toHaveLength(1)
    expect(result.adopted[0]).toMatchObject({ source: 'curseforge', title: 'CF Mod', fileName: 'cf-mod.jar' })
    // The stale 'unknown' entry is replaced, not left alongside the new one.
    expect(updated.installedMods).toHaveLength(1)
    expect(updated.installedMods[0].source).toBe('curseforge')
  })

  it('does not duplicate an existing "unknown" entry when it is still unmatched this round', async () => {
    const existingUnknown: InstalledMinecraftMod = {
      source: 'unknown',
      projectId: 'local:mystery.jar',
      slug: 'mystery',
      title: 'mystery',
      versionId: '',
      versionNumber: '',
      fileName: 'mystery.jar',
      enabled: true,
      installedAs: 'user',
      installedAt: Date.now()
    }
    const profile = makeProfile({ installedMods: [existingUnknown] }, tmpDir)
    fs.mkdirSync(modTargetDir(profile), { recursive: true })
    fs.writeFileSync(path.join(modTargetDir(profile), 'mystery.jar'), 'unknown content')
    mockGetModrinthVersionsFromHashes.mockResolvedValue({})

    const { profile: updated, result } = await scanForInstalledMods(profile)

    // Nothing changed this round - not re-reported as newly "adopted", and not duplicated in
    // installedMods either.
    expect(result.adopted).toHaveLength(0)
    expect(updated.installedMods).toHaveLength(1)
    expect(mockSaveMinecraftProfile).not.toHaveBeenCalled()
  })
})

describe('openMinecraftModsFolder', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-mods-openfolder-test-'))
    mockOpenPath.mockClear()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates the mods/plugins folder if missing, then opens it', async () => {
    const profile = makeProfile({}, tmpDir)
    const targetDir = modTargetDir(profile)
    expect(fs.existsSync(targetDir)).toBe(false)

    await openMinecraftModsFolder(profile)

    expect(fs.existsSync(targetDir)).toBe(true)
    expect(mockOpenPath).toHaveBeenCalledWith(targetDir)
  })

  it('rejects for a server type with no mod/plugin ecosystem', async () => {
    const profile = makeProfile({ serverType: 'vanilla' }, tmpDir)
    await expect(openMinecraftModsFolder(profile)).rejects.toThrow(/mod\/plugin ecosystem/)
    expect(mockOpenPath).not.toHaveBeenCalled()
  })
})
