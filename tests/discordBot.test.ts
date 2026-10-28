import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '@shared/types'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-bot-test-'))

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir }
}))

const mockSaveSettings = vi.fn((settings: AppSettings) => settings)
const mockSaveWebDashboardApiKey = vi.fn()
const mockDeleteWebDashboardApiKey = vi.fn()
let currentSettings: AppSettings

vi.mock('../src/main/store', () => ({
  getSettings: () => currentSettings,
  saveSettings: (settings: AppSettings) => mockSaveSettings(settings),
  saveWebDashboardApiKey: (key: unknown) => mockSaveWebDashboardApiKey(key),
  deleteWebDashboardApiKey: (id: string) => mockDeleteWebDashboardApiKey(id)
}))

class FakeChildProcess extends EventEmitter {
  killed = false
  send = vi.fn()
  kill = vi.fn(() => {
    this.killed = true
  })
  stdout = new EventEmitter()
  stderr = new EventEmitter()
}

let lastFork: { scriptPath: string; args: string[]; child: FakeChildProcess } | null = null
const forkMock = vi.fn((scriptPath: string, args: string[]) => {
  const child = new FakeChildProcess()
  lastFork = { scriptPath, args, child }
  return child
})

vi.mock('node:child_process', () => ({
  fork: (scriptPath: string, args: string[], _options: unknown) => forkMock(scriptPath, args)
}))

const { startDiscordBot, stopDiscordBot, getDiscordBotStatus, notifyGameEvent } = await import('../src/main/lib/discordBot')

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    steamCmdPath: '',
    dataDir: tmpDir,
    webDashboardEnabled: true,
    webDashboardPort: 8090,
    webDashboardHost: '127.0.0.1',
    webDashboardDisabledLabels: [],
    launchOnStartup: false,
    closeToTrayEnabled: false,
    webDashboardAuthEnabled: false,
    serverAutoStartStaggerSeconds: 10,
    iniLockEnabled: true,
    statsHistoryMaxSizeMB: 1024,
    statsHistoryMaxAgeHours: 24,
    showServerConsoleWindow: true,
    groupOrder: [],
    collapsedGroups: [],
    minecraftGroupOrder: [],
    minecraftCollapsedGroups: [],
    curseforgeApiKey: '',
    discordBotEnabled: true,
    discordBotToken: 'fake-token',
    discordBotDevGuildId: '',
    discordBotStatusChannelId: '',
    discordBotRefreshSeconds: 60,
    discordBotStatusEmbedTitle: 'Statut',
    discordBotStatusEmbedDescription: '',
    discordBotStatusEmbedColor: '9B59B6',
    discordBotArkCheckEnabled: true,
    discordBotMcStatusChannelId: '',
    discordBotMcRefreshSeconds: 60,
    discordBotMcStatusEmbedTitle: 'Statut MC',
    discordBotMcStatusEmbedDescription: '',
    discordBotMcStatusEmbedColor: '9B59B6',
    discordBotMcCheckEnabled: true,
    discordBotDisplayEnabled: true,
    discordBotPresenceEnabled: true,
    discordBotChatBridgeEnabled: true,
    discordBotMaintenanceWhitelistIds: [],
    discordBotManagerWhitelistIds: [],
    discordBotCurseforgeModuleEnabled: true,
    discordBotCurseforgeDefaultModIds: [],
    discordBotCurseforgeCheckIntervalMinutes: 10,
    discordBotApiKeyId: '',
    ...overrides
  }
}

function readWrittenConfig(): Record<string, unknown> {
  const configPath = lastFork?.args[0]
  if (!configPath) throw new Error('fork was never called')
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
}

beforeEach(() => {
  mockSaveSettings.mockClear()
  mockSaveWebDashboardApiKey.mockClear()
  mockDeleteWebDashboardApiKey.mockClear()
  forkMock.mockClear()
  lastFork = null
})

afterEach(() => {
  stopDiscordBot()
})

describe('startDiscordBot', () => {
  it('does nothing when the integration is disabled', async () => {
    await startDiscordBot(makeSettings({ discordBotEnabled: false }))
    expect(forkMock).not.toHaveBeenCalled()
  })

  it('does nothing when no token is configured', async () => {
    await startDiscordBot(makeSettings({ discordBotToken: '  ' }))
    expect(forkMock).not.toHaveBeenCalled()
  })

  it('spawns the bot with no managerApiKey when auth is disabled', async () => {
    currentSettings = makeSettings({ webDashboardAuthEnabled: false })
    await startDiscordBot(currentSettings)

    expect(forkMock).toHaveBeenCalledTimes(1)
    // In the real bundled app this resolves to out/bot/index.js (a sibling of out/main/,
    // where this file's own code ends up bundled) - here it's just this source file's own
    // directory, since nothing is bundled under vitest. Either way it must be "<dir>/../bot/index.js".
    expect(lastFork?.scriptPath).toMatch(/[/\\]bot[/\\]index\.js$/)
    const config = readWrittenConfig()
    expect(config.managerApiKey).toBeUndefined()
    expect(config.managerApiUrl).toBe('http://127.0.0.1:8090')
    expect(mockSaveWebDashboardApiKey).not.toHaveBeenCalled()
  })

  it('auto-provisions a fresh Web Dashboard API key when auth is enabled, revoking any previous one', async () => {
    currentSettings = makeSettings({ webDashboardAuthEnabled: true, discordBotApiKeyId: 'old-key-id' })
    await startDiscordBot(currentSettings)

    expect(mockDeleteWebDashboardApiKey).toHaveBeenCalledWith('old-key-id')
    expect(mockSaveWebDashboardApiKey).toHaveBeenCalledTimes(1)
    const savedKey = mockSaveWebDashboardApiKey.mock.calls[0][0] as { role: string; label: string }
    expect(savedKey.role).toBe('moderator')
    expect(savedKey.label).toContain('Discord Bot')

    const config = readWrittenConfig()
    expect(config.managerApiKey).toMatch(/^ark_/)
    expect(config.managerApiUrl).toBe('https://127.0.0.1:8090')
    expect(mockSaveSettings).toHaveBeenCalledWith(expect.objectContaining({ discordBotApiKeyId: expect.any(String) }))
  })

  it('connects via the configured dashboard host, not a hardcoded 127.0.0.1, when it is a specific LAN IP', async () => {
    // Node's http(s) server only binds to the exact host given - a real report showed the
    // bot getting ECONNREFUSED against a hardcoded 127.0.0.1 when the dashboard was
    // actually bound to a specific LAN IP (chosen to expose it to other devices).
    currentSettings = makeSettings({ webDashboardHost: '192.168.1.50' })
    await startDiscordBot(currentSettings)
    const config = readWrittenConfig()
    expect(config.managerApiUrl).toBe('http://192.168.1.50:8090')
  })

  it('falls back to 127.0.0.1 for an empty or wildcard (0.0.0.0) host', async () => {
    currentSettings = makeSettings({ webDashboardHost: '' })
    await startDiscordBot(currentSettings)
    expect(readWrittenConfig().managerApiUrl).toBe('http://127.0.0.1:8090')

    currentSettings = makeSettings({ webDashboardHost: '0.0.0.0' })
    await startDiscordBot(currentSettings)
    expect(readWrittenConfig().managerApiUrl).toBe('http://127.0.0.1:8090')
  })

  it('reuses the global CurseForge API key setting instead of asking for a second one', async () => {
    currentSettings = makeSettings({ curseforgeApiKey: 'shared-key' })
    await startDiscordBot(currentSettings)
    const config = readWrittenConfig()
    expect((config.curseforge as { apiKey: string }).apiKey).toBe('shared-key')
  })

  it('stops any previously running bot before spawning a new one', async () => {
    currentSettings = makeSettings()
    await startDiscordBot(currentSettings)
    const firstChild = lastFork?.child
    await startDiscordBot(currentSettings)

    expect(forkMock).toHaveBeenCalledTimes(2)
    expect(firstChild?.send).toHaveBeenCalledWith({ type: 'stop' })
  })
})

describe('getDiscordBotStatus', () => {
  it('reports running right after a successful spawn', async () => {
    await startDiscordBot(makeSettings())
    expect(getDiscordBotStatus()).toEqual({ running: true, error: null })
  })

  it('reports an error after the child exits with a non-zero code', async () => {
    await startDiscordBot(makeSettings())
    lastFork?.child.emit('exit', 1)
    expect(getDiscordBotStatus().running).toBe(false)
    expect(getDiscordBotStatus().error).toMatch(/inattendue/)
  })

  it('reports not running after stopDiscordBot', async () => {
    await startDiscordBot(makeSettings())
    stopDiscordBot()
    expect(getDiscordBotStatus().running).toBe(false)
  })
})

describe('discordBotDisplayEnabled - master switch over the bot\'s visible output', () => {
  it('passes the ARK/Minecraft status-check and presence/chat-bridge flags through as-is when the master switch is on', async () => {
    currentSettings = makeSettings({
      discordBotDisplayEnabled: true,
      discordBotArkCheckEnabled: true,
      discordBotMcCheckEnabled: false,
      discordBotPresenceEnabled: true,
      discordBotChatBridgeEnabled: false
    })
    await startDiscordBot(currentSettings)
    const config = readWrittenConfig()
    expect(config.arkCheckEnabled).toBe(true)
    expect(config.mcCheckEnabled).toBe(false)
    expect(config.presenceEnabled).toBe(true)
    expect(config.chatBridgeEnabled).toBe(false)
  })

  it('overrides every sub-toggle to false when the master switch is off, regardless of their own state', async () => {
    currentSettings = makeSettings({
      discordBotDisplayEnabled: false,
      discordBotArkCheckEnabled: true,
      discordBotMcCheckEnabled: true,
      discordBotPresenceEnabled: true,
      discordBotChatBridgeEnabled: true
    })
    await startDiscordBot(currentSettings)
    const config = readWrittenConfig()
    expect(config.arkCheckEnabled).toBe(false)
    expect(config.mcCheckEnabled).toBe(false)
    expect(config.presenceEnabled).toBe(false)
    expect(config.chatBridgeEnabled).toBe(false)
  })
})

describe('notifyGameEvent - outbound half (game -> Discord) of the chat/events relay', () => {
  it('sends the gameEvent IPC message when both the master switch and the chat-bridge sub-toggle are on', async () => {
    currentSettings = makeSettings({ discordBotDisplayEnabled: true, discordBotChatBridgeEnabled: true })
    await startDiscordBot(currentSettings)
    const child = lastFork?.child
    child?.send.mockClear()

    notifyGameEvent('channel-1', 'chat', 'Alice: hello')

    expect(child?.send).toHaveBeenCalledWith({ type: 'gameEvent', channelId: 'channel-1', kind: 'chat', text: 'Alice: hello' })
  })

  it('does not send when the master switch is off', async () => {
    await startDiscordBot(makeSettings())
    const child = lastFork?.child
    child?.send.mockClear()
    // notifyGameEvent reads getSettings() fresh on every call (not whatever was passed to
    // startDiscordBot above - the spawn already happened, this just changes what it sees next).
    currentSettings = makeSettings({ discordBotDisplayEnabled: false, discordBotChatBridgeEnabled: true })

    notifyGameEvent('channel-1', 'chat', 'Alice: hello')

    expect(child?.send).not.toHaveBeenCalled()
  })

  it('does not send when just the chat-bridge sub-toggle is off', async () => {
    await startDiscordBot(makeSettings())
    const child = lastFork?.child
    child?.send.mockClear()
    currentSettings = makeSettings({ discordBotDisplayEnabled: true, discordBotChatBridgeEnabled: false })

    notifyGameEvent('channel-1', 'chat', 'Alice: hello')

    expect(child?.send).not.toHaveBeenCalled()
  })
})
