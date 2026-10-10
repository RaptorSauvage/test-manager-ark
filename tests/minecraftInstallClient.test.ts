import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  listVanillaVersions,
  getVanillaServerDownload,
  listPaperVersions,
  getLatestPaperBuild,
  paperDownloadUrl,
  listFabricGameVersions,
  getLatestFabricLoaderVersion,
  getLatestFabricInstallerVersion,
  fabricServerJarUrl,
  listForgeVersionsForMinecraft,
  forgeInstallerUrl
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

describe('Paper client', () => {
  it('listPaperVersions reverses PaperMC\'s oldest-first list to newest-first', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeJsonResponse({ versions: ['1.19', '1.19.1', '1.20.1'] })))
    expect(await listPaperVersions()).toEqual(['1.20.1', '1.19.1', '1.19'])
  })

  it('getLatestPaperBuild picks the highest build number and fetches its download info', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeJsonResponse({ builds: [10, 11, 12] }))
      .mockResolvedValueOnce(
        fakeJsonResponse({ downloads: { application: { name: 'paper-1.20.1-12.jar', checksums: { sha256: 'deadbeef' } } } })
      )
    vi.stubGlobal('fetch', fetchMock)
    const result = await getLatestPaperBuild('1.20.1')
    expect(result).toEqual({ build: 12, fileName: 'paper-1.20.1-12.jar', sha256: 'deadbeef' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('getLatestPaperBuild throws clearly when a version has no builds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeJsonResponse({ builds: [] })))
    await expect(getLatestPaperBuild('99.99')).rejects.toThrow(/No Paper builds/)
  })

  it('paperDownloadUrl builds the documented download path', () => {
    expect(paperDownloadUrl('1.20.1', 12, 'paper-1.20.1-12.jar')).toBe(
      'https://api.papermc.io/v2/projects/paper/versions/1.20.1/builds/12/downloads/paper-1.20.1-12.jar'
    )
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
})
