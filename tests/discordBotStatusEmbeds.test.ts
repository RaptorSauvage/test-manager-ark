import { afterEach, describe, expect, it } from 'vitest'
import type { ManagerServerInfo, DiscordBotConfig } from '../shared/discordBot'
import { buildStatusEmbed, buildMinecraftStatusEmbed, parseHexColor, playersFieldValue } from '../src/bot/statusEmbeds'
import { allArkMaintenanceIds, setArkMaintenance, setCheckDisabled } from '../src/bot/maintenanceState'

function makeServer(overrides: Partial<ManagerServerInfo> = {}): ManagerServerInfo {
  return {
    id: 'server-1',
    name: 'Island',
    group: '',
    maxPlayers: 70,
    state: 'running',
    players: [],
    cpu: null,
    memoryMB: null,
    startedAt: null,
    gameVersion: null,
    gameDisplayName: 'ARK: Survival Ascended',
    ...overrides
  }
}

function makeConfig(overrides: Partial<DiscordBotConfig> = {}): DiscordBotConfig {
  return {
    discordToken: 'x',
    stateDir: '/tmp',
    managerApiUrl: '',
    managerApiTimeoutMs: 1000,
    refreshSeconds: 60,
    statusEmbedTitle: 'Statut',
    statusEmbedDescription: '',
    statusEmbedColor: '9B59B6',
    arkCheckEnabled: true,
    mcRefreshSeconds: 60,
    mcStatusEmbedTitle: 'Statut MC',
    mcStatusEmbedDescription: '',
    mcStatusEmbedColor: '9B59B6',
    mcCheckEnabled: true,
    maintenanceWhitelistIds: [],
    managerWhitelistIds: [],
    curseforge: { apiKey: '', moduleEnabled: true, defaultModIds: [], checkIntervalMinutes: 10 },
    ...overrides
  }
}

afterEach(() => {
  for (const id of allArkMaintenanceIds()) setArkMaintenance(id, null)
  setCheckDisabled('server-1', false)
})

describe('parseHexColor', () => {
  it('parses a hex color with or without a leading #', () => {
    expect(parseHexColor('FF5733')).toBe(0xff5733)
    expect(parseHexColor('#FF5733')).toBe(0xff5733)
  })

  it('falls back to the default on empty/invalid input', () => {
    expect(parseHexColor('')).toBe(0x9b59b6)
    expect(parseHexColor(undefined)).toBe(0x9b59b6)
    expect(parseHexColor('not-a-color')).toBe(0x9b59b6)
  })
})

describe('playersFieldValue', () => {
  it('shows a placeholder when nobody is connected', () => {
    expect(playersFieldValue([])).toBe('Aucun joueur connecté')
  })

  it('lists every name as a bullet when under the cap', () => {
    expect(playersFieldValue(['Alice', 'Bob'])).toBe('• Alice\n• Bob')
  })

  it('truncates past 30 names with a counter for the rest', () => {
    const names = Array.from({ length: 35 }, (_, i) => `Player${i}`)
    const value = playersFieldValue(names)
    expect(value.split('\n')).toHaveLength(31) // 30 bullets + the "… et N de plus" line
    expect(value).toContain('… et 5 de plus')
  })
})

describe('buildStatusEmbed', () => {
  it('shows the cluster as online with a player count when a server is running', () => {
    const server = makeServer({ players: ['Alice'] })
    const embed = buildStatusEmbed([server], [], makeConfig()).data
    const system = embed.fields?.[0].value ?? ''
    const cluster = embed.fields?.[1].value ?? ''
    expect(system).toContain('🟢  **Status Cluster** - En ligne')
    expect(cluster).toContain('🟢  **Island** - 1/70 joueurs')
  })

  it('shows a maintenance override instead of the real state', () => {
    const server = makeServer({ state: 'running' })
    setArkMaintenance(server.id, { reason: 'Mise à jour' })
    const embed = buildStatusEmbed([server], [], makeConfig()).data
    const cluster = embed.fields?.[1].value ?? ''
    expect(cluster).toContain('🔧  **Island** - En maintenance - Mise à jour')
  })

  it('excludes a check-disabled server from the embed and its counts entirely', () => {
    const servers = [makeServer({ id: 'a', name: 'Island', state: 'running' }), makeServer({ id: 'b', name: 'Center', state: 'stopped' })]
    setCheckDisabled('b', true)
    const embed = buildStatusEmbed(servers, [], makeConfig()).data
    const cluster = embed.fields?.[1].value ?? ''
    expect(cluster).not.toContain('Center')
    expect(embed.footer?.text).toContain('1/1 serveur(s) en ligne')
    setCheckDisabled('b', false)
  })

  it('labels a non-running Manager state using its own icon/label, not "Hors ligne"', () => {
    const server = makeServer({ state: 'updating' })
    const embed = buildStatusEmbed([server], [], makeConfig()).data
    const cluster = embed.fields?.[1].value ?? ''
    expect(cluster).toContain('🔵  **Island** - Mise à jour en cours')
  })

  it("shows each Manager group as its own field, named after the group, instead of one combined Cluster field", () => {
    const servers = [
      makeServer({ id: 'a', name: 'Island', group: 'Cluster' }),
      makeServer({ id: 'b', name: 'Center', group: 'Cluster' }),
      makeServer({ id: 'c', name: 'Dev PTR', group: 'Testing', state: 'stopped' })
    ]
    const embed = buildStatusEmbed(servers, [], makeConfig()).data
    const fieldNames = embed.fields?.map((f) => f.name) ?? []
    expect(fieldNames).toEqual(['🖥️ Système', '📡 Cluster', '📡 Testing'])

    const clusterField = embed.fields?.find((f) => f.name === '📡 Cluster')?.value ?? ''
    expect(clusterField).toContain('Island')
    expect(clusterField).toContain('Center')
    expect(clusterField).not.toContain('Dev PTR')

    const testingField = embed.fields?.find((f) => f.name === '📡 Testing')?.value ?? ''
    expect(testingField).toContain('Dev PTR')
    expect(testingField).not.toContain('Island')
  })

  it('falls back to a "Cluster" field name for a server with no group set', () => {
    const server = makeServer({ group: '' })
    const embed = buildStatusEmbed([server], [], makeConfig()).data
    const fieldNames = embed.fields?.map((f) => f.name) ?? []
    expect(fieldNames).toContain('📡 Cluster')
  })

  it('preserves the order groups already arrive in rather than alphabetizing them', () => {
    const servers = [
      makeServer({ id: 'a', name: 'Dev PTR', group: 'Testing' }),
      makeServer({ id: 'b', name: 'Island', group: 'Cluster' })
    ]
    const embed = buildStatusEmbed(servers, [], makeConfig()).data
    const fieldNames = embed.fields?.map((f) => f.name) ?? []
    expect(fieldNames).toEqual(['🖥️ Système', '📡 Testing', '📡 Cluster'])
  })
})

describe('buildMinecraftStatusEmbed', () => {
  it('shows a running Minecraft server with its player count', () => {
    const server = makeServer({ gameDisplayName: 'Minecraft', serverType: 'paper', players: ['Alice', 'Bob'], maxPlayers: 20 })
    const embed = buildMinecraftStatusEmbed([server], [], makeConfig()).data
    const list = embed.fields?.[1].value ?? ''
    expect(list).toContain('🟢  **Island** - 2/20 joueurs')
  })

  it('shows an offline Minecraft server as Hors ligne', () => {
    const server = makeServer({ gameDisplayName: 'Minecraft', serverType: 'paper', state: 'stopped' })
    const embed = buildMinecraftStatusEmbed([server], [], makeConfig()).data
    const list = embed.fields?.[1].value ?? ''
    expect(list).toContain('🔴  **Island** - Hors ligne')
  })

  it('also groups Minecraft servers into their own Manager group fields', () => {
    const servers = [
      makeServer({ id: 'a', name: 'Survie', group: 'Cluster', gameDisplayName: 'Minecraft', serverType: 'paper' }),
      makeServer({ id: 'b', name: 'Dev MC', group: 'Testing', gameDisplayName: 'Minecraft', serverType: 'paper', state: 'stopped' })
    ]
    const embed = buildMinecraftStatusEmbed(servers, [], makeConfig()).data
    const fieldNames = embed.fields?.map((f) => f.name) ?? []
    expect(fieldNames).toEqual(['🖥️ Système', '⛏️ Cluster', '⛏️ Testing'])
  })
})
