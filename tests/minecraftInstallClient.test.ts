import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  listVanillaVersions,
  getVanillaServerDownload,
  listPaperVersions,
  listPaperBuilds,
  getLatestPaperBuild,
  getPaperBuild,
  listPaperBuildOptions,
  listFabricGameVersions,
  getLatestFabricLoaderVersion,
  getLatestFabricInstallerVersion,
  listFabricLoaderOptions,
  fabricServerJarUrl,
  listForgeVersionsForMinecraft,
  listForgeMinecraftVersions,
  listForgeLoaderOptions,
  forgeInstallerUrl,
  listNeoForgeVersions,
  listNeoForgeMinecraftVersions,
  listNeoForgeLoaderOptions,
  neoForgeInstallerUrl,
  neoForgeVersionToMinecraftVersion,
  listSpongeMinecraftVersions,
  listSpongeLoaderOptions,
  spongeDownloadUrl
} from '../src/main/lib/minecraftInstallClient'

function fakeJsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response
}

function fakeTextResponse(body: string, ok = true, status = 200): Response {
  return { ok, status, text: async () => body, json: async () => JSON.parse(body) } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listVanillaVersions', () => {
  it('returns only release-type versions, in manifest order', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeJsonResponse({
          latest: { release: '1.20.1', snapshot: '1.20.1' },
          versions: [
            { id: '1.20.1', type: 'release', url: 'https://example.com/1.20.1.json' },
            { id: '23w31a', type: 'snapshot', url: 'https://example.com/23w31a.json' },
            { id: '1.20', type: 'release', url: 'https://example.com/1.20.json' }
          ]
        })
      )
    )
    const versions = await listVanillaVersions()
    expect(versions.map((v) => v.id)).toEqual(['1.20.1', '1.20'])
  })

  it('throws a clear error on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeJsonResponse({}, false, 503)))
    await expect(listVanillaVersions()).rejects.toThrow(/HTTP 503/)
  })
})

describe('getVanillaServerDownload', () => {
  it('returns the server download info when present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(fakeJsonResponse({ downloads: { server: { url: 'https://x/server.jar', sha1: 'abc', size: 123 } } }))
    )
    const download = await getVanillaServerDownload('https://example.com/1.20.1.json')
    expect(download).toEqual({ url: 'https://x/server.jar', sha1: 'abc', size: 123 })
  })

  it('returns undefined when a version has no server download at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeJsonResponse({ downloads: {} })))
    const download = await getVanillaServerDownload('https://example.com/old.json')
    expect(download).toBeUndefined()
  })
})

describe('Paper client (Fill v3 API)', () => {
  it('listPaperVersions flattens Fill\'s version-group map and reverses it to newest-first', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(fakeJsonResponse({ versions: { '1.19': ['1.19', '1.19.1'], '1.20': ['1.20', '1.20.1'] } }))
    )
    expect(await listPaperVersions()).toEqual(['1.20.1', '1.20', '1.19.1', '1.19'])
  })

  const BUILDS = [
    { id: 12, channel: 'STABLE', downloads: { 'server:default': { name: 'paper-1.20.1-12.jar', url: 'https://fill-data.papermc.io/12.jar', checksums: { sha256: 'deadbeef' } } } },
    { id: 13, channel: 'BETA', downloads: { 'server:default': { name: 'paper-1.20.1-13.jar', url: 'https://fill-data.papermc.io/13.jar', checksums: { sha256: 'feedface' } } } }
  ]

  it('getLatestPaperBuild prefers the newest STABLE-channel build over a newer non-stable one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeJsonResponse(BUILDS)))
    const result = await getLatestPaperBuild('1.20.1')
    expect(result).toEqual({ build: 12, fileName: 'paper-1.20.1-12.jar', sha256: 'deadbeef', url: 'https://fill-data.papermc.io/12.jar' })
  })

  it('getLatestPaperBuild falls back to the first build when none is STABLE yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeJsonResponse([BUILDS[1]])))
    const result = await getLatestPaperBuild('1.21.5')
    expect(result.build).toBe(13)
  })

  it('getLatestPaperBuild throws clearly when a version has no builds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeJsonResponse([])))
    await expect(getLatestPaperBuild('99.99')).rejects.toThrow(/No Paper builds/)
  })

  it('getPaperBuild fetches a specific build rather than always the latest', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeJsonResponse(BUILDS)))
    const result = await getPaperBuild('1.20.1', 13)
    expect(result).toEqual({ build: 13, fileName: 'paper-1.20.1-13.jar', sha256: 'feedface', url: 'https://fill-data.papermc.io/13.jar' })
  })

  it('getPaperBuild throws clearly when the requested build does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeJsonResponse(BUILDS)))
    await expect(getPaperBuild('1.20.1', 999)).rejects.toThrow(/Paper build 999/)
  })

  it('listPaperBuildOptions stars the first STABLE build as recommended', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeJsonResponse(BUILDS)))
    const options = await listPaperBuildOptions('1.20.1')
    expect(options).toEqual([
      { id: '12', label: 'Build 12 (stable)', recommended: true },
      { id: '13', label: 'Build 13 (beta)', recommended: false }
    ])
  })

  it('listPaperBuilds returns the raw build list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeJsonResponse(BUILDS)))
    expect(await listPaperBuilds('1.20.1')).toEqual(BUILDS)
  })
})

describe('Fabric client', () => {
  it('listFabricGameVersions keeps only stable versions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeJsonResponse([
          { version: '1.20.1', stable: true },
          { version: '23w31a', stable: false }
        ])
      )
    )
    expect(await listFabricGameVersions()).toEqual(['1.20.1'])
  })

  it('getLatestFabricLoaderVersion prefers the stable entry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeJsonResponse([
          { loader: { version: '0.15.0-beta', stable: false } },
          { loader: { version: '0.14.21', stable: true } }
        ])
      )
    )
    expect(await getLatestFabricLoaderVersion('1.20.1')).toBe('0.14.21')
  })

  it('getLatestFabricLoaderVersion throws clearly when there are no loader builds at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeJsonResponse([])))
    await expect(getLatestFabricLoaderVersion('0.0.0')).rejects.toThrow(/no loader builds/)
  })

  it('getLatestFabricInstallerVersion prefers the stable entry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeJsonResponse([
          { version: '1.0.1', stable: true },
          { version: '1.0.2-beta', stable: false }
        ])
      )
    )
    expect(await getLatestFabricInstallerVersion()).toBe('1.0.1')
  })

  it('fabricServerJarUrl builds the documented on-the-fly server jar path', () => {
    expect(fabricServerJarUrl('1.20.1', '0.14.21', '1.0.1')).toBe(
      'https://meta.fabricmc.net/v2/versions/loader/1.20.1/0.14.21/1.0.1/server/jar'
    )
  })

  it('listFabricLoaderOptions stars the first stable loader version as recommended', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeJsonResponse([
          { loader: { version: '0.15.0-beta', stable: false } },
          { loader: { version: '0.14.21', stable: true } }
        ])
      )
    )
    expect(await listFabricLoaderOptions('1.20.1')).toEqual([
      { id: '0.15.0-beta', label: '0.15.0-beta', recommended: false },
      { id: '0.14.21', label: '0.14.21 (stable)', recommended: true }
    ])
  })
})

describe('Forge client', () => {
  it('listForgeVersionsForMinecraft filters to the given mcVersion and reverses to newest-first', async () => {
    const xml = `<metadata><versioning><versions>
      <version>1.19.4-45.1.0</version>
      <version>1.20.1-47.1.0</version>
      <version>1.20.1-47.2.0</version>
    </versions></versioning></metadata>`
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeTextResponse(xml)))
    expect(await listForgeVersionsForMinecraft('1.20.1')).toEqual(['1.20.1-47.2.0', '1.20.1-47.1.0'])
  })

  it('listForgeVersionsForMinecraft returns an empty list for a version Forge never targeted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeTextResponse('<metadata><versioning><versions></versions></versioning></metadata>')))
    expect(await listForgeVersionsForMinecraft('1.1.1')).toEqual([])
  })

  it('forgeInstallerUrl builds the documented Maven installer path', () => {
    expect(forgeInstallerUrl('1.20.1', '47.2.0')).toBe(
      'https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.2.0/forge-1.20.1-47.2.0-installer.jar'
    )
  })

  const FORGE_XML = `<metadata><versioning><versions>
      <version>1.19.4-45.1.0</version>
      <version>1.20.1-47.1.0</version>
      <version>1.20.1-47.2.0</version>
    </versions></versioning></metadata>`

  it('listForgeMinecraftVersions groups combos by their mcVersion prefix, newest-build-first order preserved', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeTextResponse(FORGE_XML)))
    expect(await listForgeMinecraftVersions()).toEqual(['1.20.1', '1.19.4'])
  })

  it('listForgeLoaderOptions strips the mcVersion prefix and stars the promotions-marked recommended build', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeTextResponse(FORGE_XML))
      .mockResolvedValueOnce(fakeJsonResponse({ promos: { '1.20.1-recommended': '47.1.0', '1.20.1-latest': '47.2.0' } }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await listForgeLoaderOptions('1.20.1')).toEqual([
      { id: '47.2.0', label: '47.2.0', recommended: false },
      { id: '47.1.0', label: '47.1.0', recommended: true }
    ])
  })

  it('listForgeLoaderOptions falls back to "latest" when Forge has not marked a recommended build yet', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeTextResponse(FORGE_XML))
      .mockResolvedValueOnce(fakeJsonResponse({ promos: { '1.20.1-latest': '47.2.0' } }))
    vi.stubGlobal('fetch', fetchMock)
    const options = await listForgeLoaderOptions('1.20.1')
    expect(options.find((o) => o.recommended)?.id).toBe('47.2.0')
  })

  it('listForgeLoaderOptions still returns the version list, unstarred, if the promotions file fails', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(fakeTextResponse(FORGE_XML)).mockResolvedValueOnce(fakeJsonResponse({}, false, 500))
    vi.stubGlobal('fetch', fetchMock)
    const options = await listForgeLoaderOptions('1.20.1')
    expect(options.map((o) => o.id)).toEqual(['47.2.0', '47.1.0'])
    expect(options.every((o) => !o.recommended)).toBe(true)
  })
})

describe('NeoForge client', () => {
  it('listNeoForgeVersions reverses the oldest-first maven-metadata.xml listing to newest-first', async () => {
    const xml = `<metadata><versioning><versions>
      <version>20.2.86</version>
      <version>21.1.72</version>
    </versions></versioning></metadata>`
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeTextResponse(xml)))
    expect(await listNeoForgeVersions()).toEqual(['21.1.72', '20.2.86'])
  })

  it('neoForgeInstallerUrl builds the documented Maven installer path', () => {
    expect(neoForgeInstallerUrl('21.1.72')).toBe(
      'https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.72/neoforge-21.1.72-installer.jar'
    )
  })

  it('neoForgeVersionToMinecraftVersion derives the Minecraft version per NeoForge\'s documented scheme', () => {
    expect(neoForgeVersionToMinecraftVersion('21.1.72')).toBe('1.21.1')
    expect(neoForgeVersionToMinecraftVersion('20.2.86')).toBe('1.20.2')
    // A zero patch component is dropped, not kept as "1.21.0".
    expect(neoForgeVersionToMinecraftVersion('21.0.15')).toBe('1.21')
  })

  it('neoForgeVersionToMinecraftVersion throws clearly for a string that does not match the scheme', () => {
    expect(() => neoForgeVersionToMinecraftVersion('not-a-version')).toThrow(/Not a recognized NeoForge version/)
  })

  const NEOFORGE_XML = `<metadata><versioning><versions>
      <version>20.2.86</version>
      <version>21.1.70</version>
      <version>21.1.72</version>
    </versions></versioning></metadata>`

  it('listNeoForgeMinecraftVersions groups builds by their derived Minecraft version', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeTextResponse(NEOFORGE_XML)))
    expect(await listNeoForgeMinecraftVersions()).toEqual(['1.21.1', '1.20.2'])
  })

  it('listNeoForgeLoaderOptions filters to the given Minecraft version and stars the newest build', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeTextResponse(NEOFORGE_XML)))
    expect(await listNeoForgeLoaderOptions('1.21.1')).toEqual([
      { id: '21.1.72', label: '21.1.72', recommended: true },
      { id: '21.1.70', label: '21.1.70', recommended: false }
    ])
  })
})

describe('Sponge client (Maven repo)', () => {
  const SPONGEVANILLA_XML = `<metadata><versioning><versions>
      <version>1.20.1-9.0.0</version>
      <version>1.21.1-10.0.0</version>
      <version>1.21.1-10.1.0</version>
    </versions></versioning></metadata>`

  it('listSpongeMinecraftVersions groups combos by their mcVersion prefix', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeTextResponse(SPONGEVANILLA_XML)))
    expect(await listSpongeMinecraftVersions('spongevanilla')).toEqual(['1.21.1', '1.20.1'])
  })

  it('listSpongeLoaderOptions strips the mcVersion prefix and stars the newest build', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeTextResponse(SPONGEVANILLA_XML)))
    expect(await listSpongeLoaderOptions('spongevanilla', '1.21.1')).toEqual([
      { id: '10.1.0', label: '10.1.0', recommended: true },
      { id: '10.0.0', label: '10.0.0', recommended: false }
    ])
  })

  it('listSpongeLoaderOptions returns an empty list for a Minecraft version with no builds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeTextResponse(SPONGEVANILLA_XML)))
    expect(await listSpongeLoaderOptions('spongevanilla', '1.1.1')).toEqual([])
  })

  it('spongeDownloadUrl builds the assumed Maven-layout download path', () => {
    expect(spongeDownloadUrl('spongevanilla', '1.21.1', '10.1.0')).toBe(
      'https://repo.spongepowered.org/repository/maven-public/org/spongepowered/spongevanilla/1.21.1-10.1.0/spongevanilla-1.21.1-10.1.0.jar'
    )
    expect(spongeDownloadUrl('spongeforge', '1.20.1', '9.0.0')).toBe(
      'https://repo.spongepowered.org/repository/maven-public/org/spongepowered/spongeforge/1.20.1-9.0.0/spongeforge-1.20.1-9.0.0.jar'
    )
  })
})
