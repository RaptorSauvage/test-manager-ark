import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiscordBotConfig, ManagerServerInfo } from '../shared/discordBot'
import { arkServers, findServerByName, minecraftServers, refreshServerCache } from '../src/bot/serverCache'

const island: ManagerServerInfo = {
  id: 'a',
  name: 'Island',
  group: '',
  maxPlayers: 70,
  state: 'running',
  players: [],
  cpu: null,
  memoryMB: null,
  startedAt: null,
  gameVersion: null,
  gameDisplayName: 'ARK: Survival Ascended'
}

const survie: ManagerServerInfo = {
  id: 'b',
  name: 'Survie',
  group: '',
  maxPlayers: 20,
  state: 'running',
  players: [],
  cpu: null,
  memoryMB: null,
  startedAt: null,
  gameVersion: null,
  gameDisplayName: 'Minecraft',
  serverType: 'paper'
}

function makeConfig(): DiscordBotConfig {
  return {
    discordToken: 'x',
    stateDir: '/tmp',
    managerApiUrl: 'http://127.0.0.1:8090',
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
    curseforge: { apiKey: '', moduleEnabled: true, defaultModIds: [], checkIntervalMinutes: 10 }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('serverCache', () => {
  it('splits ARK and Minecraft servers using the serverType discriminator', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 200, json: async () => [island, survie] }) as unknown as Response)
    )
    await refreshServerCache(makeConfig())

    expect(arkServers().map((s) => s.name)).toEqual(['Island'])
    expect(minecraftServers().map((s) => s.name)).toEqual(['Survie'])
  })

  it('finds a server by name case-insensitively', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 200, json: async () => [island] }) as unknown as Response)
    )
    await refreshServerCache(makeConfig())

    expect(findServerByName('island')).toEqual(island)
    expect(findServerByName('ISLAND')).toEqual(island)
    expect(findServerByName('nope')).toBeUndefined()
  })
})
