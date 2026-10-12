import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiscordBotConfig } from '../shared/discordBot'
import { fetchManagerServers, managerApiPost, sendManagerRconCommand, ManagerApiError } from '../src/bot/managerApiClient'

function makeConfig(overrides: Partial<DiscordBotConfig> = {}): DiscordBotConfig {
  return {
    discordToken: 'x',
    stateDir: '/tmp',
    managerApiUrl: 'http://127.0.0.1:8090',
    managerApiKey: 'ark_abc_secret',
    managerApiTimeoutMs: 1000,
    refreshSeconds: 60,
    statusEmbedTitle: '',
    statusEmbedDescription: '',
    statusEmbedColor: '',
    arkCheckEnabled: true,
    mcRefreshSeconds: 60,
    mcStatusEmbedTitle: '',
    mcStatusEmbedDescription: '',
    mcStatusEmbedColor: '',
    mcCheckEnabled: true,
    maintenanceWhitelistIds: [],
    managerWhitelistIds: [],
    groupOrder: [],
    minecraftGroupOrder: [],
    curseforge: { apiKey: '', moduleEnabled: true, defaultModIds: [], checkIntervalMinutes: 10 },
    ...overrides
  }
}

function fakeResponse(status: number, body: unknown): Response {
  return {
    status,
    json: async () => body
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('managerApiPost', () => {
  it('sends the Bearer token and the JSON body', async () => {
    const fetchMock = vi.fn(async () => fakeResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await managerApiPost(makeConfig(), '/api/servers/1/rcon', { command: 'ListPlayers' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8090/api/servers/1/rcon')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer ark_abc_secret' })
    expect((init as RequestInit).body).toBe(JSON.stringify({ command: 'ListPlayers' }))
  })

  it('raises a clear French error on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(401, {})))
    await expect(managerApiPost(makeConfig(), '/api/servers/1/start')).rejects.toThrow(ManagerApiError)
    await expect(managerApiPost(makeConfig(), '/api/servers/1/start')).rejects.toThrow(/invalide/)
  })

  it('raises a clear French error on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(403, {})))
    await expect(managerApiPost(makeConfig(), '/api/servers/1/start')).rejects.toThrow(/Permissions insuffisantes/)
  })

  it('surfaces the server-provided error message on other 4xx/5xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(404, { error: 'Unknown server' })))
    await expect(managerApiPost(makeConfig(), '/api/servers/x/start')).rejects.toThrow('Unknown server')
  })

  it('rejects with a clear message when managerApiUrl is empty', async () => {
    await expect(managerApiPost(makeConfig({ managerApiUrl: '' }), '/api/servers/1/start')).rejects.toThrow(ManagerApiError)
  })

  it('surfaces the underlying network error (err.cause), not just the generic "fetch failed"', async () => {
    // undici's fetch wraps every connection-level failure in a bare `TypeError: fetch
    // failed` with the real reason only on `.cause` - a real report showed this logging
    // nothing but "fetch failed" with no way to tell ECONNREFUSED apart from a cert error.
    const networkError = new TypeError('fetch failed')
    ;(networkError as { cause?: unknown }).cause = new Error('connect ECONNREFUSED 127.0.0.1:8090')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw networkError
      })
    )
    await expect(managerApiPost(makeConfig(), '/api/servers/1/start')).rejects.toThrow(/ECONNREFUSED 127\.0\.0\.1:8090/)
  })
})

describe('fetchManagerServers', () => {
  it('returns the array on success', async () => {
    const servers = [{ id: '1', name: 'Island' }]
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(200, servers)))
    expect(await fetchManagerServers(makeConfig())).toEqual(servers)
  })

  it('returns an empty array instead of throwing when the Manager is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      })
    )
    expect(await fetchManagerServers(makeConfig())).toEqual([])
  })

  it('returns an empty array when the response is not a JSON array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(200, { not: 'an array' })))
    expect(await fetchManagerServers(makeConfig())).toEqual([])
  })
})

describe('sendManagerRconCommand', () => {
  it('posts to the server-scoped rcon route with the command in the body', async () => {
    const fetchMock = vi.fn(async () => fakeResponse(200, { ok: true, response: 'OK' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendManagerRconCommand(makeConfig(), 'server-1', 'DestroyWildDinos')

    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8090/api/servers/server-1/rcon')
    expect(result).toEqual({ ok: true, response: 'OK' })
  })
})
