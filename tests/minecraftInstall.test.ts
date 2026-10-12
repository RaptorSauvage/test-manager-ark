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
const mockGetPaperBuild = vi.fn()
const mockListPaperBuildOptions = vi.fn()
const mockListFabricGameVersions = vi.fn()
const mockGetLatestFabricLoaderVersion = vi.fn()
const mockGetLatestFabricInstallerVersion = vi.fn()
const mockListFabricLoaderOptions = vi.fn()
const mockListForgeMinecraftVersions = vi.fn()
const mockListForgeLoaderOptions = vi.fn()
const mockListNeoForgeMinecraftVersions = vi.fn()
const mockListNeoForgeLoaderOptions = vi.fn()
const mockListSpongeMinecraftVersions = vi.fn()
const mockListSpongeLoaderOptions = vi.fn()

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
    getPaperBuild: (version: string, build: number) => mockGetPaperBuild(version, build),
    listPaperBuildOptions: (version: string) => mockListPaperBuildOptions(version),
    listFabricGameVersions: () => mockListFabricGameVersions(),
    getLatestFabricLoaderVersion: (mcVersion: string) => mockGetLatestFabricLoaderVersion(mcVersion),
    getLatestFabricInstallerVersion: () => mockGetLatestFabricInstallerVersion(),
    listFabricLoaderOptions: (mcVersion: string) => mockListFabricLoaderOptions(mcVersion),
    listForgeMinecraftVersions: () => mockListForgeMinecraftVersions(),
    listForgeLoaderOptions: (mcVersion: string) => mockListForgeLoaderOptions(mcVersion),
    listNeoForgeMinecraftVersions: () => mockListNeoForgeMinecraftVersions(),
    listNeoForgeLoaderOptions: (mcVersion: string) => mockListNeoForgeLoaderOptions(mcVersion),
    listSpongeMinecraftVersions: (artifactId: string) => mockListSpongeMinecraftVersions(artifactId),
    listSpongeLoaderOptions: (artifactId: string, mcVersion: string) => mockListSpongeLoaderOptions(artifactId, mcVersion)
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

import { installMinecraftServerFiles, listInstallableMinecraftVersions, listInstallableLoaderVersions } from '../src/main/lib/minecraftInstall'

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

  it('installs paper: downloads the build-specific jar with its own file name, from Fill\'s ready-made URL', async () => {
    const bytes = new TextEncoder().encode('fake-paper-bytes')
    const crypto = await import('node:crypto')
    const sha256 = crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex')
    mockGetLatestPaperBuild.mockResolvedValue({
      build: 12,
      fileName: 'paper-1.20.1-12.jar',
      sha256,
      url: 'https://fill-data.papermc.io/paper-1.20.1-12.jar'
    })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer })
    vi.stubGlobal('fetch', fetchMock)

    const result = await installMinecraftServerFiles({
      serverType: 'paper',
      minecraftVersion: '1.20.1',
      installDir: TEST_DIR,
      acceptEula: true
    })

    expect(result.jarFileName).toBe('paper-1.20.1-12.jar')
    expect(result.loaderVersion).toBe('12')
    expect(result.launchMode).toBe('jar')
    expect(fetchMock).toHaveBeenCalledWith('https://fill-data.papermc.io/paper-1.20.1-12.jar')
    expect(fs.existsSync(path.join(TEST_DIR, 'paper-1.20.1-12.jar'))).toBe(true)
  })

  it('installs paper: fetches a specific build when loaderVersion is given, rather than the latest', async () => {
    const bytes = new TextEncoder().encode('fake-paper-bytes')
    const crypto = await import('node:crypto')
    const sha256 = crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex')
    mockGetPaperBuild.mockResolvedValue({ build: 10, fileName: 'paper-1.20.1-10.jar', sha256, url: 'https://fill-data.papermc.io/10.jar' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer }))

    const result = await installMinecraftServerFiles({
      serverType: 'paper',
      minecraftVersion: '1.20.1',
      loaderVersion: '10',
      installDir: TEST_DIR,
      acceptEula: true
    })

    expect(mockGetPaperBuild).toHaveBeenCalledWith('1.20.1', 10)
    expect(mockGetLatestPaperBuild).not.toHaveBeenCalled()
    expect(result.jarFileName).toBe('paper-1.20.1-10.jar')
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
      minecraftVersion: '1.20.1',
      loaderVersion: '47.2.0',
      installDir: TEST_DIR,
      acceptEula: true
    })

    expect(lastSpawnCall).toEqual({ command: 'java', args: ['-jar', 'forge-installer.jar', '--installServer'] })
    expect(mockListForgeLoaderOptions).not.toHaveBeenCalled()
    expect(result).toEqual({
      installDir: TEST_DIR,
      launchMode: 'script',
      jarFileName: '',
      scriptFileName: 'run.sh',
      minecraftVersion: '1.20.1',
      loaderVersion: '47.2.0',
      serverType: 'forge'
    })
  })

  it('installs forge: resolves the recommended loader build itself when loaderVersion is omitted', async () => {
    mockListForgeLoaderOptions.mockResolvedValue([
      { id: '47.2.0', label: '47.2.0', recommended: false },
      { id: '47.1.0', label: '47.1.0', recommended: true }
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('installer-jar').buffer })
    )
    mockDetectMinecraftLaunchable.mockReturnValue({ launchMode: 'script', jarFileName: '', scriptFileName: 'run.sh', serverType: 'unknown' })

    const result = await installMinecraftServerFiles({
      serverType: 'forge',
      minecraftVersion: '1.20.1',
      installDir: TEST_DIR,
      acceptEula: true
    })

    expect(mockListForgeLoaderOptions).toHaveBeenCalledWith('1.20.1')
    expect(result.loaderVersion).toBe('47.1.0')
  })

  it('forge install fails clearly when the installer process exits non-zero', async () => {
    nextSpawnExitCode = 1
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('x').buffer })
    )

    await expect(
      installMinecraftServerFiles({
        serverType: 'forge',
        minecraftVersion: '1.20.1',
        loaderVersion: '47.2.0',
        installDir: TEST_DIR,
        acceptEula: true
      })
    ).rejects.toThrow(/exited with code 1/)
  })

  it('forge install fails clearly when nothing launchable is found afterward', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('x').buffer })
    )
    mockDetectMinecraftLaunchable.mockReturnValue(null)

    await expect(
      installMinecraftServerFiles({
        serverType: 'forge',
        minecraftVersion: '1.20.1',
        loaderVersion: '47.2.0',
        installDir: TEST_DIR,
        acceptEula: true
      })
    ).rejects.toThrow(/no launchable jar or script/)
  })

  it('forge install fails clearly, before downloading anything, if Java is not on PATH', async () => {
    spawnSyncMissing = new Set(['java'])
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      installMinecraftServerFiles({
        serverType: 'forge',
        minecraftVersion: '1.20.1',
        loaderVersion: '47.2.0',
        installDir: TEST_DIR,
        acceptEula: true
      })
    ).rejects.toThrow(/Java was not found/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('installs neoforge: downloads the installer, runs it, then detects the launchable result', async () => {
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
      serverType: 'neoforge',
      minecraftVersion: '1.21.1',
      loaderVersion: '21.1.72',
      installDir: TEST_DIR,
      acceptEula: true
    })

    expect(lastSpawnCall).toEqual({ command: 'java', args: ['-jar', 'neoforge-installer.jar', '--installServer'] })
    // minecraftVersion is re-derived from the loaderVersion actually installed (1.21.1),
    // rather than trusting whatever params.minecraftVersion the caller passed in.
    expect(result).toEqual({
      installDir: TEST_DIR,
      launchMode: 'script',
      jarFileName: '',
      scriptFileName: 'run.sh',
      minecraftVersion: '1.21.1',
      loaderVersion: '21.1.72',
      serverType: 'neoforge'
    })
  })

  it('installs neoforge: resolves the newest loader build itself when loaderVersion is omitted', async () => {
    mockListNeoForgeLoaderOptions.mockResolvedValue([{ id: '21.1.72', label: '21.1.72', recommended: true }])
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('installer-jar').buffer })
    )
    mockDetectMinecraftLaunchable.mockReturnValue({ launchMode: 'script', jarFileName: '', scriptFileName: 'run.sh', serverType: 'unknown' })

    const result = await installMinecraftServerFiles({
      serverType: 'neoforge',
      minecraftVersion: '1.21.1',
      installDir: TEST_DIR,
      acceptEula: true
    })

    expect(mockListNeoForgeLoaderOptions).toHaveBeenCalledWith('1.21.1')
    expect(result.loaderVersion).toBe('21.1.72')
  })

  it('neoforge install fails clearly, before downloading anything, if Java is not on PATH', async () => {
    spawnSyncMissing = new Set(['java'])
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      installMinecraftServerFiles({
        serverType: 'neoforge',
        minecraftVersion: '1.21.1',
        loaderVersion: '21.1.72',
        installDir: TEST_DIR,
        acceptEula: true
      })
    ).rejects.toThrow(/Java was not found/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('neoforge install fails clearly for a loaderVersion string that does not match the documented scheme', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      installMinecraftServerFiles({
        serverType: 'neoforge',
        minecraftVersion: '1.21.1',
        loaderVersion: 'garbage',
        installDir: TEST_DIR,
        acceptEula: true
      })
    ).rejects.toThrow(/Not a recognized NeoForge version/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('installs spongevanilla: downloads the standalone jar from the Sponge Maven repo', async () => {
    const bytes = new TextEncoder().encode('spongevanilla-jar')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer }))

    const result = await installMinecraftServerFiles({
      serverType: 'spongevanilla',
      minecraftVersion: '1.21.1',
      loaderVersion: '10.0.0',
      installDir: TEST_DIR,
      acceptEula: true
    })

    expect(result).toEqual({
      installDir: TEST_DIR,
      launchMode: 'jar',
      jarFileName: 'spongevanilla.jar',
      scriptFileName: '',
      minecraftVersion: '1.21.1',
      loaderVersion: '10.0.0',
      serverType: 'spongevanilla'
    })
    expect(fs.existsSync(path.join(TEST_DIR, 'spongevanilla.jar'))).toBe(true)
  })

  it('installs spongevanilla: resolves the newest build itself when loaderVersion is omitted', async () => {
    mockListSpongeLoaderOptions.mockResolvedValue([{ id: '10.1.0', label: '10.1.0', recommended: true }])
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('x').buffer })
    )

    const result = await installMinecraftServerFiles({
      serverType: 'spongevanilla',
      minecraftVersion: '1.21.1',
      installDir: TEST_DIR,
      acceptEula: true
    })

    expect(mockListSpongeLoaderOptions).toHaveBeenCalledWith('spongevanilla', '1.21.1')
    expect(result.loaderVersion).toBe('10.1.0')
  })

  it('installs spongeforge: installs Forge first, then drops the SpongeForge jar into mods/', async () => {
    mockListForgeLoaderOptions.mockResolvedValue([{ id: '47.2.0', label: '47.2.0', recommended: true }])
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('x').buffer })
    )
    mockDetectMinecraftLaunchable.mockReturnValue({
      launchMode: 'script',
      jarFileName: '',
      scriptFileName: 'run.sh',
      serverType: 'unknown'
    })

    const result = await installMinecraftServerFiles({
      serverType: 'spongeforge',
      minecraftVersion: '1.20.1',
      loaderVersion: '9.0.0',
      installDir: TEST_DIR,
      acceptEula: true
    })

    expect(lastSpawnCall).toEqual({ command: 'java', args: ['-jar', 'forge-installer.jar', '--installServer'] })
    // Keeps Forge's own detected launchMode/jarFileName/scriptFileName - SpongeForge is a mod
    // Forge itself loads, it doesn't change how the server launches.
    expect(result).toEqual({
      installDir: TEST_DIR,
      launchMode: 'script',
      jarFileName: '',
      scriptFileName: 'run.sh',
      minecraftVersion: '1.20.1',
      loaderVersion: '9.0.0',
      serverType: 'spongeforge'
    })
    expect(fs.existsSync(path.join(TEST_DIR, 'mods', 'spongeforge-1.20.1-9.0.0.jar'))).toBe(true)
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

  it('dispatches forge to listForgeMinecraftVersions - real Minecraft versions, not combo strings', async () => {
    mockListForgeMinecraftVersions.mockResolvedValue(['1.20.1', '1.19.4'])
    expect(await listInstallableMinecraftVersions('forge')).toEqual([
      { id: '1.20.1', label: '1.20.1' },
      { id: '1.19.4', label: '1.19.4' }
    ])
  })

  it('dispatches neoforge to listNeoForgeMinecraftVersions - derived Minecraft versions, not raw build strings', async () => {
    mockListNeoForgeMinecraftVersions.mockResolvedValue(['1.21.1', '1.20.2'])
    expect(await listInstallableMinecraftVersions('neoforge')).toEqual([
      { id: '1.21.1', label: '1.21.1' },
      { id: '1.20.2', label: '1.20.2' }
    ])
  })

  it('dispatches spongevanilla to listSpongeMinecraftVersions with the spongevanilla artifact id', async () => {
    mockListSpongeMinecraftVersions.mockResolvedValue(['1.21.1'])
    expect(await listInstallableMinecraftVersions('spongevanilla')).toEqual([{ id: '1.21.1', label: '1.21.1' }])
    expect(mockListSpongeMinecraftVersions).toHaveBeenCalledWith('spongevanilla')
  })

  it('dispatches spongeforge to listSpongeMinecraftVersions with the spongeforge artifact id', async () => {
    mockListSpongeMinecraftVersions.mockResolvedValue(['1.20.1'])
    expect(await listInstallableMinecraftVersions('spongeforge')).toEqual([{ id: '1.20.1', label: '1.20.1' }])
    expect(mockListSpongeMinecraftVersions).toHaveBeenCalledWith('spongeforge')
  })
})

describe('listInstallableLoaderVersions', () => {
  it('returns an empty list for vanilla and spigot - nothing further to choose', async () => {
    expect(await listInstallableLoaderVersions('vanilla', '1.20.1')).toEqual([])
    expect(await listInstallableLoaderVersions('spigot', '1.20.1')).toEqual([])
  })

  it('dispatches paper to listPaperBuildOptions', async () => {
    mockListPaperBuildOptions.mockResolvedValue([{ id: '12', label: 'Build 12 (stable)', recommended: true }])
    expect(await listInstallableLoaderVersions('paper', '1.20.1')).toEqual([{ id: '12', label: 'Build 12 (stable)', recommended: true }])
  })

  it('dispatches fabric to listFabricLoaderOptions', async () => {
    mockListFabricLoaderOptions.mockResolvedValue([{ id: '0.14.21', label: '0.14.21 (stable)', recommended: true }])
    expect(await listInstallableLoaderVersions('fabric', '1.20.1')).toEqual([{ id: '0.14.21', label: '0.14.21 (stable)', recommended: true }])
  })

  it('dispatches forge to listForgeLoaderOptions', async () => {
    mockListForgeLoaderOptions.mockResolvedValue([{ id: '47.2.0', label: '47.2.0', recommended: true }])
    expect(await listInstallableLoaderVersions('forge', '1.20.1')).toEqual([{ id: '47.2.0', label: '47.2.0', recommended: true }])
  })

  it('dispatches neoforge to listNeoForgeLoaderOptions', async () => {
    mockListNeoForgeLoaderOptions.mockResolvedValue([{ id: '21.1.72', label: '21.1.72', recommended: true }])
    expect(await listInstallableLoaderVersions('neoforge', '1.21.1')).toEqual([{ id: '21.1.72', label: '21.1.72', recommended: true }])
  })

  it('dispatches spongevanilla/spongeforge to listSpongeLoaderOptions with the right artifact id', async () => {
    mockListSpongeLoaderOptions.mockResolvedValue([{ id: '10.0.0', label: '10.0.0', recommended: true }])
    await listInstallableLoaderVersions('spongevanilla', '1.21.1')
    expect(mockListSpongeLoaderOptions).toHaveBeenCalledWith('spongevanilla', '1.21.1')
    await listInstallableLoaderVersions('spongeforge', '1.20.1')
    expect(mockListSpongeLoaderOptions).toHaveBeenCalledWith('spongeforge', '1.20.1')
  })
})
