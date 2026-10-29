import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiscordBotConfig, ManagerServerInfo } from '../shared/discordBot'
import {
  arkServers,
  findServerByName,
  getCachedServers,
  minecraftServers,
  refreshServerCache,
  serversForChatChannel
} from '../src/bot/serverCache'

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

  it('serversForChatChannel finds every ARK server sharing a chat channel id, ignoring Minecraft and non-matches', async () => {
    const extinction: ManagerServerInfo = { ...island, id: 'c', name: 'Extinction', discordChatChannelId: 'chat-1' }
    const theIsland = { ...island, discordChatChannelId: 'chat-1' }
    const otherChannel = { ...island, id: 'd', name: 'Other', discordChatChannelId: 'chat-2' }
    const mcSameId = { ...survie, discordChatChannelId: 'chat-1' }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 200, json: async () => [theIsland, extinction, otherChannel, mcSameId] }) as unknown as Response)
    )
    await refreshServerCache(makeConfig())

    expect(serversForChatChannel('chat-1').map((s) => s.name).sort()).toEqual(['Extinction', 'Island'])
    expect(serversForChatChannel('chat-3')).toEqual([])
  })

  it('leaves a server with discordBotExcluded out of the cache entirely - as if it does not exist for the bot', async () => {
    const excludedArk = { ...island, id: 'e', name: 'Hidden Ark', discordBotExcluded: true }
    const excludedMc = { ...survie, id: 'f', name: 'Hidden MC', discordBotExcluded: true }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 200, json: async () => [island, survie, excludedArk, excludedMc] }) as unknown as Response)
    )
    await refreshServerCache(makeConfig())

    expect(getCachedServers().map((s) => s.name).sort()).toEqual(['Island', 'Survie'])
    expect(arkServers().map((s) => s.name)).toEqual(['Island'])
    expect(minecraftServers().map((s) => s.name)).toEqual(['Survie'])
    expect(findServerByName('Hidden Ark')).toBeUndefined()
    expect(findServerByName('Hidden MC')).toBeUndefined()
  })
})
