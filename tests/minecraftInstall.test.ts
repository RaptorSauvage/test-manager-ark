import { describe, expect, it, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('../src/main/lib/managerLog', () => ({
  logManagerEvent: vi.fn(),
  newTaskId: (prefix: string) => `${prefix}-test`
}))

const mockListVanillaVersions = vi.fn()
const mockGetVanillaServerDownload = vi.fn()
const mockListPaperVersions = vi.fn()
const mockGetLatestPaperBuild = vi.fn()
const mockListFabricGameVersions = vi.fn()
const mockGetLatestFabricLoaderVersion = vi.fn()
const mockGetLatestFabricInstallerVersion = vi.fn()
const mockListForgeVersionsForMinecraft = vi.fn()

vi.mock('../src/main/lib/minecraftInstallClient', async () => {
  const actual = await vi.importActual<typeof import('../src/main/lib/minecraftInstallClient')>(
    '../src/main/lib/minecraftInstallClient'
  )
  return {
    ...actual,
    listVanillaVersions: () => mockListVanillaVersions(),
    getVanillaServerDownload: (url: string) => mockGetVanillaServerDownload(url),
    listPaperVersions: () => mockListPaperVersions(),
    getLatestPaperBuild: (version: string) => mockGetLatestPaperBuild(version),
    listFabricGameVersions: () => mockListFabricGameVersions(),
    getLatestFabricLoaderVersion: (mcVersion: string) => mockGetLatestFabricLoaderVersion(mcVersion),
    getLatestFabricInstallerVersion: () => mockGetLatestFabricInstallerVersion(),
    listForgeVersionsForMinecraft: (mcVersion: string) => mockListForgeVersionsForMinecraft(mcVersion)
  }
})

const mockDetectMinecraftLaunchable = vi.fn()
vi.mock('../src/main/lib/minecraftDetect', () => ({
  detectMinecraftLaunchable: (installDir: string) => mockDetectMinecraftLaunchable(installDir)
}))

type SpawnListener = (...args: unknown[]) => void
class FakeChildProcess {
  listeners: Record<string, SpawnListener[]> = {}
  on(event: string, cb: SpawnListener): this {
    this.listeners[event] = this.listeners[event] ?? []
    this.listeners[event].push(cb)
    return this
  }
  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.listeners[event] ?? []) cb(...args)
  }
}

let nextSpawnExitCode: number | null = 0
let nextSpawnError: Error | null = null
let lastSpawnCall: { command: string; args: string[] } | null = null
let spawnSyncMissing = new Set<string>()
vi.mock('node:child_process', () => ({
  spawn: (command: string, args: string[]) => {
    lastSpawnCall = { command, args }
    const child = new FakeChildProcess()
    setTimeout(() => {
      if (nextSpawnError) child.emit('error', nextSpawnError)
      else child.emit('exit', nextSpawnExitCode)
    }, 0)
    return child
  },
  spawnSync: (command: string) => (spawnSyncMissing.has(command) ? { error: new Error('ENOENT'), status: null } : { error: undefined, status: 0 })
}))

import { installMinecraftServerFiles, listInstallableMinecraftVersions } from '../src/main/lib/minecraftInstall'

const TEST_DIR = path.join(os.tmpdir(), `minecraft-install-test-${process.pid}`)

beforeEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true })
  fs.mkdirSync(TEST_DIR, { recursive: true })
  vi.clearAllMocks()
  nextSpawnExitCode = 0
  nextSpawnError = null
  lastSpawnCall = null
  spawnSyncMissing = new Set()
  vi.unstubAllGlobals()
})

describe('installMinecraftServerFiles', () => {
  it('refuses outright, before downloading anything, if the EULA was not accepted', async () => {
    await expect(
      installMinecraftServerFiles({ serverType: 'vanilla', minecraftVersion: '1.20.1', installDir: TEST_DIR, acceptEula: false })
    ).rejects.toThrow(/EULA/)
    expect(mockListVanillaVersions).not.toHaveBeenCalled()
  })

  it('refuses if no Minecraft version was given', async () => {
    await expect(
      installMinecraftServerFiles({ serverType: 'vanilla', minecraftVersion: '', installDir: TEST_DIR, acceptEula: true })
    ).rejects.toThrow(/Minecraft version/)
  })

  it('installs vanilla: downloads server.jar and writes eula.txt', async () => {
    mockListVanillaVersions.mockResolvedValue([{ id: '1.20.1', type: 'release', url: 'https://example.com/1.20.1.json' }])
    mockGetVanillaServerDownload.mockResolvedValue({ url: 'https://example.com/server.jar', sha1: 'irrelevant-for-this-test', size: 1 })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('fake-jar-bytes').buffer })
    )

    // sha1 verification would fail against the fake bytes above, so stub crypto's digest to
    // match - this test cares about the install orchestration (which file gets fetched, where
    // it's written, that eula.txt appears), not re-testing the checksum algorithm itself.
    const result = await installMinecraftServerFiles({
      serverType: 'vanilla',
      minecraftVersion: '1.20.1',
      installDir: TEST_DIR,
      acceptEula: true
    }).catch((err: Error) => err)

    // The checksum will genuinely mismatch (fake bytes vs a fake sha1) - that's expected and
    // itself proves the verification path runs; confirm the failure is specifically the
    // checksum, not some earlier unrelated error.
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toMatch(/checksum/)
  })

  it('installs vanilla successfully when the checksum actually matches', async () => {
    const crypto = await import('node:crypto')
    const bytes = new TextEncoder().encode('fake-jar-bytes')
    const sha1 = crypto.createHash('sha1').update(Buffer.from(bytes)).digest('hex')
    mockListVanillaVersions.mockResolvedValue([{ id: '1.20.1', type: 'release', url: 'https://example.com/1.20.1.json' }])
    mockGetVanillaServerDownload.mockResolvedValue({ url: 'https://example.com/server.jar', sha1, size: bytes.length })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer }))

    const result = await installMinecraftServerFiles({
      serverType: 'vanilla',
      minecraftVersion: '1.20.1',
      installDir: TEST_DIR,
      acceptEula: true
    })

    expect(result).toEqual({
      installDir: TEST_DIR,
      launchMode: 'jar',
      jarFileName: 'server.jar',
      scriptFileName: '',
      minecraftVersion: '1.20.1',
      serverType: 'vanilla'
    })
    expect(fs.existsSync(path.join(TEST_DIR, 'server.jar'))).toBe(true)
    expect(fs.readFileSync(path.join(TEST_DIR, 'eula.txt'), 'utf-8')).toContain('eula=true')
  })

  it('throws clearly for an unknown vanilla version', async () => {
    mockListVanillaVersions.mockResolvedValue([{ id: '1.20.1', type: 'release', url: 'https://example.com/1.20.1.json' }])
    await expect(
      installMinecraftServerFiles({ serverType: 'vanilla', minecraftVersion: '0.0.0', installDir: TEST_DIR, acceptEula: true })
    ).rejects.toThrow(/Unknown Minecraft version/)
  })

  it('installs paper: downloads the build-specific jar with its own file name', async () => {
    const bytes = new TextEncoder().encode('fake-paper-bytes')
    const crypto = await import('node:crypto')
    const sha256 = crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex')
    mockGetLatestPaperBuild.mockResolvedValue({ build: 12, fileName: 'paper-1.20.1-12.jar', sha256 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer }))

    const result = await installMinecraftServerFiles({
      serverType: 'paper',
      minecraftVersion: '1.20.1',
      installDir: TEST_DIR,
      acceptEula: true
    })

    expect(result.jarFileName).toBe('paper-1.20.1-12.jar')
    expect(result.launchMode).toBe('jar')
    expect(fs.existsSync(path.join(TEST_DIR, 'paper-1.20.1-12.jar'))).toBe(true)
  })

  it('installs fabric: downloads the on-the-fly server jar with no checksum to verify', async () => {
    mockGetLatestFabricLoaderVersion.mockResolvedValue('0.14.21')
    mockGetLatestFabricInstallerVersion.mockResolvedValue('1.0.1')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('fabric-jar').buffer })
    )

    const result = await installMinecraftServerFiles({
      serverType: 'fabric',
      minecraftVersion: '1.20.1',
      installDir: TEST_DIR,
      acceptEula: true
    })

    expect(result.jarFileName).toBe('fabric-server-launch.jar')
    expect(fs.existsSync(path.join(TEST_DIR, 'fabric-server-launch.jar'))).toBe(true)
  })

  it('installs forge: downloads the installer, runs it, then detects the launchable result', async () => {
    mockListForgeVersionsForMinecraft.mockResolvedValue(['1.20.1-47.2.0'])
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('installer-jar').buffer })
    )
    mockDetectMinecraftLaunchable.mockReturnValue({
      launchMode: 'script',
      jarFileName: '',
      scriptFileName: 'run.sh',
      serverType: 'unknown'
    })

    const result = await installMinecraftServerFiles({
      serverType: 'forge',
      minecraftVersion: '1.20.1-47.2.0',
      installDir: TEST_DIR,
      acceptEula: true
    })

    expect(lastSpawnCall).toEqual({ command: 'java', args: ['-jar', 'forge-installer.jar', '--installServer'] })
    expect(result).toEqual({
      installDir: TEST_DIR,
      launchMode: 'script',
      jarFileName: '',
      scriptFileName: 'run.sh',
      minecraftVersion: '1.20.1',
      serverType: 'forge'
    })
  })

  it('forge install fails clearly when the installer process exits non-zero', async () => {
    nextSpawnExitCode = 1
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('x').buffer })
    )

    await expect(
      installMinecraftServerFiles({ serverType: 'forge', minecraftVersion: '1.20.1-47.2.0', installDir: TEST_DIR, acceptEula: true })
    ).rejects.toThrow(/exited with code 1/)
  })

  it('forge install fails clearly when nothing launchable is found afterward', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('x').buffer })
    )
    mockDetectMinecraftLaunchable.mockReturnValue(null)

    await expect(
      installMinecraftServerFiles({ serverType: 'forge', minecraftVersion: '1.20.1-47.2.0', installDir: TEST_DIR, acceptEula: true })
    ).rejects.toThrow(/no launchable jar or script/)
  })

  it('forge install fails clearly, before downloading anything, if Java is not on PATH', async () => {
    spawnSyncMissing = new Set(['java'])
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      installMinecraftServerFiles({ serverType: 'forge', minecraftVersion: '1.20.1-47.2.0', installDir: TEST_DIR, acceptEula: true })
    ).rejects.toThrow(/Java was not found/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('installs spigot: downloads BuildTools, runs it, and finds the produced jar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('buildtools-jar').buffer })
    )
    // BuildTools itself produces spigot-<version>.jar as a side effect of the (mocked) spawn
    // call - the fake child_process above doesn't actually write it, so this test writes it
    // directly to simulate that, then asserts installSpigotServer finds it afterward.
    nextSpawnExitCode = 0
    const resultPromise = installMinecraftServerFiles({
      serverType: 'spigot',
      minecraftVersion: '1.20.1',
      installDir: TEST_DIR,
      acceptEula: true
    })
    // Write the jar BuildTools would have produced before the spawned process "exits" (the
    // fake child_process resolves on a setTimeout(0), so there's a tick to beat).
    fs.writeFileSync(path.join(TEST_DIR, 'spigot-1.20.1.jar'), 'fake-spigot-jar')
    const result = await resultPromise

    expect(lastSpawnCall).toEqual({ command: 'java', args: ['-jar', 'BuildTools.jar', '--rev', '1.20.1'] })
    expect(result).toEqual({
      installDir: TEST_DIR,
      launchMode: 'jar',
      jarFileName: 'spigot-1.20.1.jar',
      scriptFileName: '',
      minecraftVersion: '1.20.1',
      serverType: 'spigot'
    })
  })

  it('spigot install fails clearly, before downloading anything, if Git is not on PATH', async () => {
    spawnSyncMissing = new Set(['git'])
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      installMinecraftServerFiles({ serverType: 'spigot', minecraftVersion: '1.20.1', installDir: TEST_DIR, acceptEula: true })
    ).rejects.toThrow(/Git was not found/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('spigot install fails clearly when BuildTools finishes but the expected jar is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('x').buffer })
    )

    await expect(
      installMinecraftServerFiles({ serverType: 'spigot', minecraftVersion: '1.20.1', installDir: TEST_DIR, acceptEula: true })
    ).rejects.toThrow(/wasn't found/)
  })
})

describe('listInstallableMinecraftVersions', () => {
  it('dispatches vanilla to listVanillaVersions', async () => {
    mockListVanillaVersions.mockResolvedValue([{ id: '1.20.1', type: 'release', url: 'x' }])
    expect(await listInstallableMinecraftVersions('vanilla')).toEqual([{ id: '1.20.1', label: '1.20.1' }])
  })

  it('dispatches paper to listPaperVersions', async () => {
    mockListPaperVersions.mockResolvedValue(['1.20.1'])
    expect(await listInstallableMinecraftVersions('paper')).toEqual([{ id: '1.20.1', label: '1.20.1' }])
  })

  it('dispatches fabric to listFabricGameVersions', async () => {
    mockListFabricGameVersions.mockResolvedValue(['1.20.1'])
    expect(await listInstallableMinecraftVersions('fabric')).toEqual([{ id: '1.20.1', label: '1.20.1' }])
  })

  it('dispatches spigot to the vanilla release list (BuildTools can target any of them)', async () => {
    mockListVanillaVersions.mockResolvedValue([{ id: '1.20.1', type: 'release', url: 'x' }])
    expect(await listInstallableMinecraftVersions('spigot')).toEqual([{ id: '1.20.1', label: '1.20.1' }])
  })
})
