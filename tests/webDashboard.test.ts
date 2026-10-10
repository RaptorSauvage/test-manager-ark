import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { PLAYER_NAME_OPEN, PLAYER_NAME_CLOSE } from '../src/main/lib/logEvents'
import type { WebDashboardAccessToken, WebDashboardApiKey } from '../shared/types'

const EMPTY_INSTALL_DIR = path.join(os.tmpdir(), `web-dashboard-test-empty-${process.pid}`)
const LOGGED_INSTALL_DIR = path.join(os.tmpdir(), `web-dashboard-test-logged-${process.pid}`)
const MINECRAFT_INSTALL_DIR = path.join(os.tmpdir(), `web-dashboard-test-mc-${process.pid}`)
// A real temp dir rather than '' - getGroupConsoleBacklog's clusterLogArchive.ts check
// calls getDataDir(), which falls back to Electron's app.getPath() (unavailable here) only
// when settings.dataDir is empty.
const DATA_DIR = path.join(os.tmpdir(), `web-dashboard-test-data-${process.pid}`)
const PLAYER = `${PLAYER_NAME_OPEN}LeRaptorSauvage${PLAYER_NAME_CLOSE}`

let mockSettings = {
  steamCmdPath: '',
  dataDir: DATA_DIR,
  webDashboardEnabled: false,
  webDashboardPort: 47091,
  webDashboardHost: '127.0.0.1',
  webDashboardDisabledLabels: [] as string[],
  launchOnStartup: false,
  webDashboardAuthEnabled: false,
  collapsedGroups: [] as string[],
  minecraftCollapsedGroups: [] as string[],
  curseforgeApiKey: ''
}

let mockAccessTokens: WebDashboardAccessToken[] = []
let mockApiKeys: WebDashboardApiKey[] = []

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockProfiles: any[] = [
  {
    id: 'p1',
    name: 'Test Server',
    game: 'ark-ascended',
    installDir: EMPTY_INSTALL_DIR,
    startOnManagerLaunch: false,
    hidden: false,
    group: '',
    backupDir: '',
    maxBackups: 10,
    backupScheduleEnabled: false,
    backupSchedule: '',
    mods: []
  },
  {
    id: 'p2',
    name: 'Logged Server',
    game: 'ark-ascended',
    installDir: LOGGED_INSTALL_DIR,
    startOnManagerLaunch: false,
    hidden: false,
    group: '',
    backupDir: '',
    maxBackups: 10,
    backupScheduleEnabled: false,
    backupSchedule: '',
    mods: []
  }
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockMinecraftProfiles: any[] = [
  {
    id: 'mc1',
    name: 'Test Minecraft Server',
    serverType: 'vanilla',
    installDir: MINECRAFT_INSTALL_DIR,
    minecraftVersion: '1.20.1',
    launchMode: 'jar',
    jarFileName: 'server.jar',
    scriptFileName: '',
    minMemoryMB: 1024,
    maxMemoryMB: 2048,
    extraJvmArgs: '',
    extraProgramArgs: 'nogui',
    hidden: false,
    group: '',
    startOnManagerLaunch: false,
    scheduledRestartEnabled: false,
    scheduledRestartTime: '00:00',
    scheduledRestartDays: [] as number[],
    scheduledRestartStartAfter: true,
    backupDir: '',
    maxBackups: 10,
    backupScheduleEnabled: false,
    backupSchedule: '',
    installedMods: [] as unknown[]
  }
]

vi.mock('../src/main/store', () => ({
  listProfiles: () => mockProfiles,
  getProfile: (id: string) => mockProfiles.find((p) => p.id === id),
  saveProfile: (profile: { id: string }) => {
    const idx = mockProfiles.findIndex((p) => p.id === profile.id)
    if (idx >= 0) mockProfiles[idx] = profile
    else mockProfiles.push(profile)
    return mockProfiles
  },
  listMinecraftProfiles: () => mockMinecraftProfiles,
  getMinecraftProfile: (id: string) => mockMinecraftProfiles.find((p) => p.id === id),
  saveMinecraftProfile: (profile: { id: string }) => {
    const idx = mockMinecraftProfiles.findIndex((p) => p.id === profile.id)
    if (idx >= 0) mockMinecraftProfiles[idx] = profile
    else mockMinecraftProfiles.push(profile)
    return mockMinecraftProfiles
  },
  getSettings: () => mockSettings,
  saveSettings: (settings: typeof mockSettings) => {
    mockSettings = settings
    return mockSettings
  },
  listWebDashboardAccessTokens: () => mockAccessTokens,
  saveWebDashboardAccessToken: (token: WebDashboardAccessToken) => {
    const idx = mockAccessTokens.findIndex((t) => t.id === token.id)
    if (idx >= 0) mockAccessTokens[idx] = token
    else mockAccessTokens.push(token)
    return mockAccessTokens
  },
  deleteWebDashboardAccessToken: (id: string) => {
    mockAccessTokens = mockAccessTokens.filter((t) => t.id !== id)
    return mockAccessTokens
  },
  listWebDashboardApiKeys: () => mockApiKeys,
  saveWebDashboardApiKey: (key: WebDashboardApiKey) => {
    const idx = mockApiKeys.findIndex((k) => k.id === key.id)
    if (idx >= 0) mockApiKeys[idx] = key
    else mockApiKeys.push(key)
    return mockApiKeys
  },
  deleteWebDashboardApiKey: (id: string) => {
    mockApiKeys = mockApiKeys.filter((k) => k.id !== id)
    return mockApiKeys
  }
}))
vi.mock('../src/main/lib/serverProcess', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/lib/serverProcess')>()
  return {
    ...actual,
    getStatus: () => ({ profileId: 'p1', state: 'running', players: ['Alice'], cpu: 12.3, memoryMB: 512 })
  }
})
vi.mock('../src/main/lib/rcon', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/lib/rcon')>()
  return {
    ...actual,
    sendRconCommand: async (_profile: unknown, command: string) => {
      if (command === 'ListPlayers') {
        return { ok: true, response: '0. Alice, 000211a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5' }
      }
      return { ok: true, response: 'pong' }
    }
  }
})
vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('../src/main/lib/serverActions', () => ({
  doStartServer: vi.fn((profile: { id: string }) => ({ profileId: profile.id, state: 'starting' })),
  doStopServer: vi.fn(async (profile: { id: string }) => ({ profileId: profile.id, state: 'stopping' })),
  doStopServerConfirmSave: vi.fn(async (_profile: { id: string }) => ({ saved: true })),
  doRestartServer: vi.fn(async (profile: { id: string }) => ({ profileId: profile.id, state: 'starting' })),
  doRestartServerConfirmSave: vi.fn(async (_profile: { id: string }) => ({ saved: true })),
  doUpdateServer: vi.fn(async () => {}),
  doStopUpdateRestart: vi.fn(async () => {})
}))
let mockSendMinecraftStdinCommand = (_id: string, _command: string): boolean => true
vi.mock('../src/main/lib/minecraftProcess', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/lib/minecraftProcess')>()
  return {
    ...actual,
    getStatus: (id: string) => ({ profileId: id, state: 'running', players: [], cpu: 5, memoryMB: 256 }),
    getConsoleBacklog: () => [{ text: 'Done (1.0s)! For help, type "help"', ts: 1735700000000 }],
    sendStdinCommand: (id: string, command: string) => mockSendMinecraftStdinCommand(id, command)
  }
})
vi.mock('../src/main/lib/minecraftActions', () => ({
  doStartMinecraftServer: vi.fn((profile: { id: string }) => ({ profileId: profile.id, state: 'starting' })),
  doStopMinecraftServer: vi.fn(async (profile: { id: string }) => ({ profileId: profile.id, state: 'stopped' }))
}))
vi.mock('../src/main/lib/minecraftRcon', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/lib/minecraftRcon')>()
  return {
    ...actual,
    sendMinecraftRconCommand: async (_installDir: string, command: string) => {
      if (command === 'list') return { ok: true, response: 'There are 1 of a max of 20 players online: Bob' }
      return { ok: true, response: 'mc-pong' }
    }
  }
})
vi.mock('../src/main/lib/arkMods', () => ({
  searchArkMods: vi.fn(async (query: string) => {
    if (!query) return []
    return [
      { id: '12345', name: 'Super Structures', summary: 'A structures mod', iconUrl: 'https://example.com/icon.png', downloads: 42 }
    ]
  }),
  getArkModsInfo: vi.fn(async (modIds: string[]) => {
    const info: Record<string, { name: string; iconUrl?: string }> = {}
    for (const id of modIds) {
      if (id === '12345') info[id] = { name: 'Super Structures', iconUrl: 'https://example.com/icon.png' }
    }
    return info
  })
}))

import { startWebDashboard, stopWebDashboard, getWebDashboardStatus, sortProfilesForDisplay } from '../src/main/lib/webDashboard'
import type { ServerProfile } from '../shared/types'
import * as serverActions from '../src/main/lib/serverActions'
import { serverEvents } from '../src/main/lib/serverProcess'
import * as minecraftActions from '../src/main/lib/minecraftActions'
import { minecraftConsoleEvents, minecraftServerEvents } from '../src/main/lib/minecraftProcess'
import { hashPassword, generateApiKeyId, generateApiKeySecret, buildApiKey } from '../src/main/lib/auth'
import { setCachedGameVersion } from '../src/main/lib/serverVersion'

const PORT = 47091

function request(
  reqPath: string,
  options: http.RequestOptions & { body?: string } = {}
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: reqPath, ...options }, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }))
    })
    req.on('error', reject)
    req.end(options.body)
  })
}

const AUTH_PORT = 47092

/** Same as request(), but over HTTPS against the auth-enabled server's self-signed cert
 *  (rejectUnauthorized: false, since Node doesn't trust a cert we just generated
 *  ourselves) - and returns headers too, since tests need to read Set-Cookie. */
function authRequest(
  reqPath: string,
  options: https.RequestOptions & { body?: string } = {}
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: '127.0.0.1', port: AUTH_PORT, path: reqPath, rejectUnauthorized: false, ...options },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }))
      }
    )
    req.on('error', reject)
    req.end(options.body)
  })
}

/** Opens a persistent SSE connection and lets a test wait for a specific chunk of raw
 *  wire content to show up (e.g. an `event: reset` line), without waiting for the
 *  response to end - which for this route, by design, never happens on its own. */
function openStream(reqPath: string): Promise<{ waitFor: (needle: string, timeoutMs?: number) => Promise<void>; destroy: () => void }> {
  return new Promise((resolveOpen) => {
    let buffer = ''
    let waiters: Array<{ needle: string; resolve: () => void }> = []
    const req = http.request({ host: '127.0.0.1', port: PORT, path: reqPath }, (res) => {
      res.on('data', (chunk) => {
        buffer += chunk
        waiters = waiters.filter(({ needle, resolve }) => {
          if (!buffer.includes(needle)) return true
          resolve()
          return false
        })
      })
      resolveOpen({
        waitFor(needle: string, timeoutMs = 2000): Promise<void> {
          if (buffer.includes(needle)) return Promise.resolve()
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${needle}"`)), timeoutMs)
            waiters.push({ needle, resolve: () => { clearTimeout(timer); resolve() } })
          })
        },
        destroy: () => req.destroy()
      })
    })
    req.end()
  })
}

function profile(overrides: Partial<ServerProfile>): ServerProfile {
  return { id: '', name: '', hidden: false, group: '', ...overrides } as ServerProfile
}

describe('sortProfilesForDisplay', () => {
  it('drops hidden profiles', () => {
    const result = sortProfilesForDisplay([
      profile({ id: 'a', hidden: false }),
      profile({ id: 'b', hidden: true })
    ])
    expect(result.map((p) => p.id)).toEqual(['a'])
  })

  it('keeps ungrouped profiles first, in their stored order', () => {
    const result = sortProfilesForDisplay([
      profile({ id: 'a', group: 'Cluster' }),
      profile({ id: 'b', group: '' }),
      profile({ id: 'c', group: '' })
    ])
    expect(result.map((p) => p.id)).toEqual(['b', 'c', 'a'])
  })

  it('orders groups alphabetically, each group in stored order', () => {
    const result = sortProfilesForDisplay([
      profile({ id: 'a', group: 'Zeta' }),
      profile({ id: 'b', group: 'Alpha' }),
      profile({ id: 'c', group: 'Zeta' }),
      profile({ id: 'd', group: 'Alpha' })
    ])
    expect(result.map((p) => p.id)).toEqual(['b', 'd', 'a', 'c'])
  })
})

describe('web dashboard HTTP server', () => {
  beforeAll(() => {
    const logsDir = path.join(LOGGED_INSTALL_DIR, 'ShooterGame', 'Saved', 'Logs')
    fs.mkdirSync(logsDir, { recursive: true })
    fs.writeFileSync(
      path.join(logsDir, 'ShooterGame.log'),
      'ARK Version: 92.28\n' +
        '[2026.07.27-21.25.23:191][991]2026.07.27_21.25.23: LeRaptorSauvage ' +
        '[UniqueNetId:0002dbe9ab20413e9b8e7e1562b76868 Platform:None] joined this ARK!\n'
    )
    // The /api/servers endpoint now just reads whatever serverVersionWatcher.ts already
    // cached (see serverVersionWatcher.test.ts for that part) rather than reading the log
    // itself on every request - seed the cache directly to simulate that having happened.
    setCachedGameVersion('p2', '92.28')
    fs.mkdirSync(MINECRAFT_INSTALL_DIR, { recursive: true })
    startWebDashboard(PORT, '127.0.0.1')
  })

  afterAll(() => {
    stopWebDashboard()
    fs.rmSync(EMPTY_INSTALL_DIR, { recursive: true, force: true })
    fs.rmSync(LOGGED_INSTALL_DIR, { recursive: true, force: true })
    fs.rmSync(MINECRAFT_INSTALL_DIR, { recursive: true, force: true })
  })

  it('serves the dashboard page at /', async () => {
    const res = await request('/')
    expect(res.status).toBe(200)
    expect(res.body).toContain('<title>Bober Server Manager - Web Console</title>')
    expect(res.body).toContain('<link rel="icon" type="image/png" href="/favicon.png" />')
  })

  it('serves the app icon as a PNG at /favicon.png, with an ETag rather than a long cache lifetime', async () => {
    const res = await request('/favicon.png')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toBe('no-cache')
    expect(res.headers['etag']).toBeTruthy()
    expect(res.body.length).toBeGreaterThan(0)
  })

  it('returns 304 for /favicon.png when the client already has the current ETag', async () => {
    const first = await request('/favicon.png')
    const res = await request('/favicon.png', { headers: { 'If-None-Match': first.headers['etag'] as string } })
    expect(res.status).toBe(304)
    expect(res.body).toBe('')
  })

  it('serves a known game icon as a PNG at /game-icons/<fileName>', async () => {
    const res = await request('/game-icons/ark-ascended.png')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.body.length).toBeGreaterThan(0)
  })

  it('serves the NeoForge per-loader-type icon too, same as a per-game one', async () => {
    const res = await request('/game-icons/neoforge.png')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.body.length).toBeGreaterThan(0)
  })

  it.each(['vanilla.png', 'paper.png', 'fabric.png', 'forge.png'])(
    'serves the %s per-loader-type icon as a PNG',
    async (fileName) => {
      const res = await request(`/game-icons/${fileName}`)
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('image/png')
      expect(res.body.length).toBeGreaterThan(0)
    }
  )

  it('serves the Spigot per-loader-type icon as a JPEG, matching its actual file type', async () => {
    const res = await request('/game-icons/spigot.jpg')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/jpeg')
    expect(res.body.length).toBeGreaterThan(0)
  })

  it('404s /game-icons/<fileName> for a file name not in the game registry', async () => {
    const res = await request('/game-icons/not-a-real-game.png')
    expect(res.status).toBe(404)
  })

  it('rejects a path-traversal attempt at /game-icons/<fileName>', async () => {
    const res = await request('/game-icons/..%2F..%2Fpackage.json')
    expect(res.status).toBe(404)
  })

  it('lists servers with their live status', async () => {
    const res = await request('/api/servers')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual([
      {
        id: 'p1',
        name: 'Test Server',
        group: '',
        groupCollapsed: false,
        state: 'running',
        players: ['Alice'],
        cpu: 12.3,
        memoryMB: 512,
        startedAt: null,
        gameVersion: null,
        statsEnabled: undefined,
        gameIconUrl: '/game-icons/ark-ascended.png',
        gameDisplayName: 'ARK: Survival Ascended'
      },
      {
        id: 'p2',
        name: 'Logged Server',
        group: '',
        groupCollapsed: false,
        state: 'running',
        players: ['Alice'],
        cpu: 12.3,
        memoryMB: 512,
        startedAt: null,
        gameVersion: '92.28',
        statsEnabled: undefined,
        gameIconUrl: '/game-icons/ark-ascended.png',
        gameDisplayName: 'ARK: Survival Ascended'
      },
      {
        id: 'mc1',
        name: 'Test Minecraft Server',
        group: '',
        groupCollapsed: false,
        maxPlayers: 20,
        state: 'running',
        players: [],
        cpu: 5,
        memoryMB: 256,
        startedAt: null,
        gameVersion: '1.20.1',
        serverType: 'vanilla',
        statsEnabled: undefined,
        gameIconUrl: '/game-icons/minecraft.png',
        gameDisplayName: 'Minecraft'
      }
    ])
  })

  describe('Minecraft servers', () => {
    it('defaults maxPlayers to 20 when the server has no server.properties file yet (reflected via the players route below, not listed in /api/servers)', async () => {
      // /api/servers doesn't surface maxPlayers at all (same as the ARK response shape above) -
      // this just documents that reading a missing server.properties doesn't throw.
      const res = await request('/api/servers')
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body).find((s: { id: string }) => s.id === 'mc1')).toBeTruthy()
    })

    it('returns the console backlog, wrapped into the same LogEvent shape ARK events use', async () => {
      const res = await request('/api/servers/mc1/events')
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toEqual([
        { label: 'LOG', cls: 'log', text: 'Done (1.0s)! For help, type "help"', ts: expect.any(String) }
      ])
    })

    it('streams a live console line over SSE', async () => {
      const stream = await openStream('/api/servers/mc1/events/stream')
      minecraftConsoleEvents.emit('line', 'mc1', { text: 'Player joined the game', ts: Date.now() })
      await stream.waitFor('Player joined the game')
      stream.destroy()
    })

    it('does not stream a line belonging to a different server', async () => {
      const stream = await openStream('/api/servers/mc1/events/stream')
      minecraftConsoleEvents.emit('line', 'p1', { text: 'Should not appear', ts: Date.now() })
      await expect(stream.waitFor('Should not appear', 150)).rejects.toThrow()
      stream.destroy()
    })

    it('emits a reset event when the server transitions to starting', async () => {
      const stream = await openStream('/api/servers/mc1/events/stream')
      minecraftServerEvents.emit('status', { profileId: 'mc1', state: 'starting' })
      await stream.waitFor('event: reset')
      stream.destroy()
    })

    it('starts a Minecraft server', async () => {
      const res = await request('/api/servers/mc1/start', { method: 'POST' })
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ ok: true })
      expect(minecraftActions.doStartMinecraftServer).toHaveBeenCalledWith(expect.objectContaining({ id: 'mc1' }))
    })

    it('stops a Minecraft server - no "saved" field, unlike ARK\'s own stop response', async () => {
      const res = await request('/api/servers/mc1/stop', { method: 'POST' })
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ ok: true })
      expect(minecraftActions.doStopMinecraftServer).toHaveBeenCalledWith(expect.objectContaining({ id: 'mc1' }))
    })

    it('rejects restart for a Minecraft server with a clear 400, rather than a 404 or silently no-op', async () => {
      const res = await request('/api/servers/mc1/restart', { method: 'POST' })
      expect(res.status).toBe(400)
      expect(JSON.parse(res.body).ok).toBe(false)
    })

    it('rejects update for a Minecraft server with a clear 400', async () => {
      const res = await request('/api/servers/mc1/update', { method: 'POST' })
      expect(res.status).toBe(400)
      expect(JSON.parse(res.body).ok).toBe(false)
    })

    it('rejects stop-update-restart for a Minecraft server with a clear 400', async () => {
      const res = await request('/api/servers/mc1/stop-update-restart', { method: 'POST' })
      expect(res.status).toBe(400)
      expect(JSON.parse(res.body).ok).toBe(false)
    })

    it('sends a command through live stdin when available, not RCON', async () => {
      mockSendMinecraftStdinCommand = () => true
      const res = await request('/api/servers/mc1/rcon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'say hello' })
      })
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ ok: true })
    })

    it('falls back to RCON when no live stdin is available (e.g. a re-adopted process)', async () => {
      mockSendMinecraftStdinCommand = () => false
      const res = await request('/api/servers/mc1/rcon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'say hello' })
      })
      mockSendMinecraftStdinCommand = () => true
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ ok: true, response: 'mc-pong' })
    })

    it('lists online players by parsing the RCON "list" command response', async () => {
      const res = await request('/api/servers/mc1/players')
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toEqual([{ name: 'Bob', id: '' }])
    })
  })

  it('returns an empty backlog when the server has no log file yet', async () => {
    const res = await request('/api/servers/p1/events')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual([])
  })

  it("reads the backlog straight from the server's own ShooterGame.log, not a captured buffer", async () => {
    const res = await request('/api/servers/p2/events')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual([
      {
        label: 'JOIN',
        cls: 'join',
        text: `${PLAYER} joined the server (ID: 0002dbe9ab20413e9b8e7e1562b76868)`,
        ts: '21:25:23',
        date: '2026.07.27'
      }
    ])
  })

  it('merges the backlog across every server in a group (both p1 and p2 are ungrouped)', async () => {
    const res = await request('/api/groups/_ungrouped_/events')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual([
      expect.objectContaining({ profileId: 'p2', profileName: 'Logged Server', label: 'JOIN' })
    ])
  })

  it('returns an empty backlog for a group with no members', async () => {
    const res = await request('/api/groups/NoSuchGroup/events')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual([])
  })

  it(
    'streams a live event tagged with its profile once a group member starts and its log grows',
    async () => {
      // watchGroupConsole defaults to a 2s poll (unlike groupConsole.test.ts, which injects a
      // fast interval - this route can't do that in production): the file has to sit still
      // for one full tick so the tailer captures its baseline size, then the append needs a
      // second tick to be picked up as new content - budget for both rather than racing them.
      const stream = await openStream('/api/groups/_ungrouped_/events/stream')
      serverEvents.emit('status', { profileId: 'p2', state: 'running' })
      await new Promise((resolve) => setTimeout(resolve, 2100)) // past the first 2s poll tick (baseline captured)

      const logPath = path.join(LOGGED_INSTALL_DIR, 'ShooterGame', 'Saved', 'Logs', 'ShooterGame.log')
      const original = fs.readFileSync(logPath, 'utf-8')
      fs.appendFileSync(
        logPath,
        '[2026.07.27-21.30.00:000][123]2026.07.27_21.30.00: LeRaptorSauvage ' +
          '[UniqueNetId:0002dbe9ab20413e9b8e7e1562b76868 Platform:None] left this ARK!\n'
      )
      try {
        await stream.waitFor('"profileId":"p2"', 2500) // covers the second poll tick
      } finally {
        stream.destroy()
        serverEvents.emit('status', { profileId: 'p2', state: 'stopped' })
        fs.writeFileSync(logPath, original) // undo the append so later tests see the original backlog again
      }
    },
    8000
  )

  it('sends an RCON command through and returns its result', async () => {
    const res = await request('/api/servers/p1/rcon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'Broadcast Hello world' })
    })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true, response: 'pong' })
  })

  it('lists online players with their ids via a fresh RCON ListPlayers call', async () => {
    const res = await request('/api/servers/p1/players')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual([{ name: 'Alice', id: '000211a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5' }])
  })

  it('returns an empty player list for an unknown server', async () => {
    const res = await request('/api/servers/unknown/players')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual([])
  })

  it('starts a server', async () => {
    const res = await request('/api/servers/p1/start', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    expect(serverActions.doStartServer).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }))
  })

  it('404s starting an unknown server', async () => {
    const res = await request('/api/servers/unknown/start', { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('reports a synchronous start failure (e.g. an update in progress) as a 400', async () => {
    vi.mocked(serverActions.doStartServer).mockImplementationOnce(() => {
      throw new Error('Cannot start the server while an update is in progress.')
    })
    const res = await request('/api/servers/p1/start', { method: 'POST' })
    expect(res.status).toBe(400)
    expect(JSON.parse(res.body)).toEqual({ ok: false, error: 'Cannot start the server while an update is in progress.' })
  })

  it('stops a server, waiting only for SaveWorld to be confirmed rather than the full shutdown', async () => {
    const res = await request('/api/servers/p1/stop', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true, saved: true })
    expect(serverActions.doStopServerConfirmSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }))
  })

  it('reports saved: false when a stop could not confirm SaveWorld', async () => {
    vi.mocked(serverActions.doStopServerConfirmSave).mockResolvedValueOnce({ saved: false })
    const res = await request('/api/servers/p1/stop', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true, saved: false })
  })

  it('restarts a server, waiting only for SaveWorld to be confirmed rather than the full restart', async () => {
    const res = await request('/api/servers/p1/restart', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true, saved: true })
    expect(serverActions.doRestartServerConfirmSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }))
  })

  it('kicks off a standalone update', async () => {
    const res = await request('/api/servers/p1/update', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    expect(serverActions.doUpdateServer).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }))
  })

  it('404s an update for an unknown server', async () => {
    const res = await request('/api/servers/unknown/update', { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('kicks off stop+update+restart', async () => {
    const res = await request('/api/servers/p1/stop-update-restart', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    expect(serverActions.doStopUpdateRestart).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }))
  })

  it('rejects an empty RCON command with a 400', async () => {
    const res = await request('/api/servers/p1/rcon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: '   ' })
    })
    expect(res.status).toBe(400)
  })

  it('404s an RCON command for an unknown server', async () => {
    const res = await request('/api/servers/unknown/rcon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'ListPlayers' })
    })
    expect(res.status).toBe(404)
  })

  it('404s an unknown route', async () => {
    const res = await request('/nope')
    expect(res.status).toBe(404)
  })

  it('reports backup status for a server with no backup directory configured', async () => {
    const res = await request('/api/servers/p1/backups/status')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({
      backupDir: '',
      maxBackups: 10,
      scheduleEnabled: false,
      scheduleCron: '',
      scheduleActive: false,
      nextRunAt: null
    })
  })

  it('lists no backups when no backup directory is configured', async () => {
    const res = await request('/api/servers/p1/backups')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual([])
  })

  it('lists no player backup folders when no backup directory is configured', async () => {
    const res = await request('/api/servers/p1/playerbackups/folders')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual([])
  })

  it('lists no player backup folders for an unknown server', async () => {
    const res = await request('/api/servers/nope/playerbackups/folders')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual([])
  })

  it('lists no player backups when no folder is given', async () => {
    const res = await request('/api/servers/p1/playerbackups')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual([])
  })

  it('lists no player backups for a folder that does not exist', async () => {
    const res = await request('/api/servers/p1/playerbackups?folder=SomePlayer_deadbeef')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual([])
  })

  it('returns an empty backup process log by default', async () => {
    const res = await request('/api/servers/p1/backups/log')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual([])
  })

  it('refuses to create a backup with no backup directory configured', async () => {
    const res = await request('/api/servers/p1/backups', { method: 'POST' })
    expect(res.status).toBe(400)
    expect(JSON.parse(res.body)).toEqual({ ok: false, error: 'Set a backup directory in the Backups tab first.' })
  })

  it('404s backup status for an unknown server', async () => {
    const res = await request('/api/servers/nope/backups/status')
    expect(res.status).toBe(404)
  })

  it('emits a reset event on the live stream when the Manager (re)starts that server', async () => {
    const stream = await openStream('/api/servers/p1/events/stream')
    serverEvents.emit('status', { profileId: 'p1', state: 'starting' })
    await stream.waitFor('event: reset')
    stream.destroy()
  })

  it('does not reset a stream for a status change belonging to a different server', async () => {
    const stream = await openStream('/api/servers/p1/events/stream')
    serverEvents.emit('status', { profileId: 'p2', state: 'starting' })
    await expect(stream.waitFor('event: reset', 150)).rejects.toThrow()
    stream.destroy()
  })

  it('reports the host it is bound to', () => {
    expect(getWebDashboardStatus()).toEqual({ running: true, error: null, host: '127.0.0.1' })
  })

  it('lists every event label as enabled by default', async () => {
    const res = await request('/api/labelsettings')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({
      JOIN: true,
      LEFT: true,
      CHAT: true,
      WARN: true,
      KILL: true,
      TAME: true,
      CMD: true,
      SAVE: true,
      CRYO: true,
      MISSION: true,
      READY: true
    })
  })

  it('404s an unknown event label', async () => {
    const res = await request('/api/labelsettings/NOT_A_LABEL', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false })
    })
    expect(res.status).toBe(404)
  })

  it('disabling a label persists it and hides it from a fresh backlog read', async () => {
    const disable = await request('/api/labelsettings/JOIN', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false })
    })
    expect(disable.status).toBe(200)
    expect(JSON.parse(disable.body)).toEqual({ label: 'JOIN', enabled: false })

    const settings = await request('/api/labelsettings')
    expect(JSON.parse(settings.body).JOIN).toBe(false)

    const events = await request('/api/servers/p2/events')
    expect(JSON.parse(events.body)).toEqual([])

    // re-enable so it doesn't leak into other tests/runs
    await request('/api/labelsettings/JOIN', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true })
    })
  })

  describe('admin-only remote control routes', () => {
    it('GET /api/servers/:id/profile returns the full profile', async () => {
      const res = await request('/api/servers/p1/profile')
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toMatchObject({ id: 'p1', name: 'Test Server' })
    })

    it('GET /api/servers/:id/profile 404s for an unknown server', async () => {
      const res = await request('/api/servers/nope/profile')
      expect(res.status).toBe(404)
    })

    it('POST /api/servers/:id/profile merges and persists fields, ignoring an id in the body', async () => {
      const res = await request('/api/servers/p1/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed Server', id: 'not-p1' })
      })
      expect(res.status).toBe(200)
      const result = JSON.parse(res.body)
      expect(result.ok).toBe(true)
      expect(result.profile.id).toBe('p1')
      expect(result.profile.name).toBe('Renamed Server')

      const reread = await request('/api/servers/p1/profile')
      expect(JSON.parse(reread.body).name).toBe('Renamed Server')

      // restore for other tests
      await request('/api/servers/p1/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Server' })
      })
    })

    it('POST /api/servers/:id/profile with a mods array saves it (the Mods tab reuses this route)', async () => {
      const mods = [{ id: 'workshop-123', enabled: true, passive: false, dev: false }]
      const res = await request('/api/servers/p1/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mods })
      })
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body).profile.mods).toEqual(mods)

      // restore for other tests
      await request('/api/servers/p1/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mods: [] })
      })
    })

    it('GET /api/servers/:id/update-log is null before any update has run, then reflects the file', async () => {
      const before = await request('/api/servers/p1/update-log')
      expect(JSON.parse(before.body)).toEqual({ log: null })

      const logPath = path.join(DATA_DIR, 'logs', 'steamcmd-update-p1.log')
      fs.mkdirSync(path.dirname(logPath), { recursive: true })
      fs.writeFileSync(logPath, 'Success! App update complete.')

      const after = await request('/api/servers/p1/update-log')
      expect(JSON.parse(after.body)).toEqual({ log: 'Success! App update complete.' })
    })

    it('GET /api/maps returns the seeded official maps and an empty custom list', async () => {
      const res = await request('/api/maps')
      expect(res.status).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.maps).toContainEqual({ id: 'TheIsland_WP', displayName: 'The Island' })
      expect(body.customMaps).toEqual([])
    })

    it('map folders: starts empty, POST creates one, GET lists it, delete removes it', async () => {
      const empty = await request('/api/servers/p1/mapfolders')
      expect(JSON.parse(empty.body)).toEqual([])

      const create = await request('/api/servers/p1/mapfolders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderName: 'Svartalfheim', fileName: 'Svartalfheim_WP.ark' })
      })
      expect(JSON.parse(create.body)).toEqual({ ok: true })

      const listed = await request('/api/servers/p1/mapfolders')
      const folders = JSON.parse(listed.body)
      expect(folders).toHaveLength(1)
      expect(folders[0].name).toBe('Svartalfheim')

      const del = await request('/api/servers/p1/mapfolders/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderName: 'Svartalfheim' })
      })
      expect(JSON.parse(del.body)).toEqual({ ok: true })

      const listedAfter = await request('/api/servers/p1/mapfolders')
      expect(JSON.parse(listedAfter.body)).toEqual([])
    })

    // Unlike its siblings above, this route only requires 'readonly' - the Analytics tab
    // that reads it is available to any role, not just admin (only toggling Enable Stats
    // itself, a profile field change, goes through the admin-gated /profile route).
    it('GET /api/servers/:id/stats returns an empty array before any samples are recorded', async () => {
      const res = await request('/api/servers/p1/stats')
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toEqual([])
    })

    it('GET /api/servers/:id/stats 404s for an unknown server', async () => {
      const res = await request('/api/servers/nope/stats')
      expect(res.status).toBe(404)
    })

    // ARK Mods tab's CurseForge port: search/icon/resolved-name, same feature as the
    // desktop app's own ModsTab (see arkMods.ts) - here exposed over HTTP instead of IPC.
    it('GET /api/arkmods/status reports whether a CurseForge API key is configured', async () => {
      const before = await request('/api/arkmods/status')
      expect(JSON.parse(before.body)).toEqual({ hasCurseForgeKey: false })

      mockSettings = { ...mockSettings, curseforgeApiKey: 'some-key' }
      const after = await request('/api/arkmods/status')
      expect(JSON.parse(after.body)).toEqual({ hasCurseForgeKey: true })
      mockSettings = { ...mockSettings, curseforgeApiKey: '' }
    })

    it('GET /api/servers/:id/mods/search returns CurseForge search hits', async () => {
      const res = await request('/api/servers/p1/mods/search?q=structures')
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toEqual([
        { id: '12345', name: 'Super Structures', summary: 'A structures mod', iconUrl: 'https://example.com/icon.png', downloads: 42 }
      ])
    })

    it('GET /api/servers/:id/mods/search 404s for an unknown server', async () => {
      const res = await request('/api/servers/nope/mods/search?q=structures')
      expect(res.status).toBe(404)
    })

    it('POST /api/servers/:id/mods/info resolves names/icons for known ids and omits unknown ones', async () => {
      const res = await request('/api/servers/p1/mods/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modIds: ['12345', '99999'] })
      })
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ '12345': { name: 'Super Structures', iconUrl: 'https://example.com/icon.png' } })
    })

    it('POST /api/servers/:id/mods/info 404s for an unknown server', async () => {
      const res = await request('/api/servers/nope/mods/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modIds: [] })
      })
      expect(res.status).toBe(404)
    })
  })

  // The Server Management tab's own narrower route (moderator+, not admin+ like everything
  // else above) - only the whitelisted schedule/watchdog fields, never the rest of the
  // profile.
  describe('moderator-accessible Server Management route', () => {
    it('GET /api/servers/:id/servermanagement returns only the whitelisted fields', async () => {
      const res = await request('/api/servers/p1/servermanagement')
      expect(res.status).toBe(200)
      // mockProfiles only sets startOnManagerLaunch among the whitelisted fields - every other
      // one comes back undefined and JSON.stringify drops it entirely, proving the route never
      // leaks the rest of the profile (e.g. installDir, backupDir) rather than asserting on
      // values.
      expect(JSON.parse(res.body)).toEqual({ startOnManagerLaunch: false })
    })

    it('GET /api/servers/:id/servermanagement 404s for an unknown server', async () => {
      const res = await request('/api/servers/nope/servermanagement')
      expect(res.status).toBe(404)
    })

    it('POST /api/servers/:id/servermanagement saves only whitelisted fields, ignoring the rest', async () => {
      const res = await request('/api/servers/p1/servermanagement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledRestartEnabled: true, scheduledRestartTime: '04:00', name: 'Hijacked name' })
      })
      expect(res.status).toBe(200)
      const result = JSON.parse(res.body)
      expect(result.ok).toBe(true)
      expect(result.profile).toEqual({
        startOnManagerLaunch: false,
        scheduledRestartEnabled: true,
        scheduledRestartTime: '04:00'
      })

      const reread = await request('/api/servers/p1/profile')
      const profile = JSON.parse(reread.body)
      expect(profile.scheduledRestartEnabled).toBe(true)
      expect(profile.scheduledRestartTime).toBe('04:00')
      // The name field in the body above must have been ignored, not just left off the
      // narrower response.
      expect(profile.name).toBe('Test Server')

      // restore for other tests
      await request('/api/servers/p1/servermanagement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledRestartEnabled: false, scheduledRestartTime: '' })
      })
    })
  })

  // Minecraft's own tabs - separate routes (mc-startsettings/mc-serversettings/mc-mods/
  // mc-backups/mc-management) from every ARK one above, mirroring the desktop Manager's own
  // separate MinecraftServerDetail tab set. Role tiers are covered in the auth-enabled describe
  // block further down; these exercise the actual route behavior.
  describe('Minecraft-specific tabs', () => {
    it('GET /api/servers/:id/mc-startsettings returns the full profile', async () => {
      const res = await request('/api/servers/mc1/mc-startsettings')
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toMatchObject({ id: 'mc1', name: 'Test Minecraft Server', serverType: 'vanilla' })
    })

    it('GET /api/servers/:id/mc-startsettings 404s for an unknown server', async () => {
      const res = await request('/api/servers/nope/mc-startsettings')
      expect(res.status).toBe(404)
    })

    it('GET /api/servers/:id/mc-startsettings 404s for an ARK server id', async () => {
      const res = await request('/api/servers/p1/mc-startsettings')
      expect(res.status).toBe(404)
    })

    it('POST /api/servers/:id/mc-startsettings merges and persists any field, ignoring an id in the body', async () => {
      const res = await request('/api/servers/mc1/mc-startsettings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed MC Server', id: 'not-mc1' })
      })
      expect(res.status).toBe(200)
      const result = JSON.parse(res.body)
      expect(result.ok).toBe(true)
      expect(result.profile.id).toBe('mc1')
      expect(result.profile.name).toBe('Renamed MC Server')

      // restore for other tests
      await request('/api/servers/mc1/mc-startsettings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Minecraft Server' })
      })
    })

    it('GET /api/servers/:id/mc-serversettings returns {} before server.properties exists', async () => {
      const res = await request('/api/servers/mc1/mc-serversettings')
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toEqual({})
    })

    it('GET /api/servers/:id/mc-serversettings 404s for an unknown server', async () => {
      const res = await request('/api/servers/nope/mc-serversettings')
      expect(res.status).toBe(404)
    })

    it('POST /api/servers/:id/mc-serversettings upserts keys into server.properties', async () => {
      const res = await request('/api/servers/mc1/mc-serversettings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 'max-players': '30', motd: 'Hello' })
      })
      expect(res.status).toBe(200)
      const result = JSON.parse(res.body)
      expect(result.ok).toBe(true)
      expect(result.properties).toEqual({ 'max-players': '30', motd: 'Hello' })

      const reread = await request('/api/servers/mc1/mc-serversettings')
      expect(JSON.parse(reread.body)).toEqual({ 'max-players': '30', motd: 'Hello' })

      fs.rmSync(path.join(MINECRAFT_INSTALL_DIR, 'server.properties'), { force: true })
    })

    it('GET /api/servers/:id/mc-management returns only the whitelisted fields', async () => {
      const res = await request('/api/servers/mc1/mc-management')
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toEqual({
        startOnManagerLaunch: false,
        scheduledRestartEnabled: false,
        scheduledRestartTime: '00:00',
        scheduledRestartDays: [],
        scheduledRestartStartAfter: true
      })
    })

    it('GET /api/servers/:id/mc-management 404s for an unknown server', async () => {
      const res = await request('/api/servers/nope/mc-management')
      expect(res.status).toBe(404)
    })

    it('POST /api/servers/:id/mc-management saves only whitelisted fields, ignoring the rest', async () => {
      const res = await request('/api/servers/mc1/mc-management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledRestartEnabled: true, scheduledRestartTime: '04:00', name: 'Hijacked name' })
      })
      expect(res.status).toBe(200)
      const result = JSON.parse(res.body)
      expect(result.ok).toBe(true)
      expect(result.profile.scheduledRestartEnabled).toBe(true)
      expect(result.profile.scheduledRestartTime).toBe('04:00')

      const reread = await request('/api/servers/mc1/mc-startsettings')
      expect(JSON.parse(reread.body).name).toBe('Test Minecraft Server')

      // restore for other tests
      await request('/api/servers/mc1/mc-management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledRestartEnabled: false, scheduledRestartTime: '00:00' })
      })
    })

    it('GET /api/servers/:id/mc-backups is empty with no backup directory configured', async () => {
      const res = await request('/api/servers/mc1/mc-backups')
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toEqual([])
    })

    it('GET /api/servers/:id/mc-backups/log is empty by default', async () => {
      const res = await request('/api/servers/mc1/mc-backups/log')
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toEqual([])
    })

    it('refuses to create an mc-backup with no backup directory configured', async () => {
      const res = await request('/api/servers/mc1/mc-backups', { method: 'POST' })
      expect(res.status).toBe(400)
      expect(JSON.parse(res.body)).toEqual({ ok: false, error: 'Set a backup directory in the Backup tab first.' })
    })

    it('POST /api/servers/:id/mc-backups/restore 404s for an unknown server', async () => {
      const res = await request('/api/servers/nope/mc-backups/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: '/tmp/x.zip' })
      })
      expect(res.status).toBe(404)
    })

    // Unlike restore, delete only ever needs a file path (deleteMinecraftBackup doesn't take
    // a profile at all) - same as ARK's own backups/delete route, it never looks up the
    // profile, so an unrestricted token's request succeeds regardless of whether :id resolves
    // to a real server.
    it('POST /api/servers/:id/mc-backups/delete does not require :id to resolve to a real server', async () => {
      const res = await request('/api/servers/nope/mc-backups/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: '/tmp/x.zip' })
      })
      expect(res.status).toBe(200)
    })

    it('GET /api/servers/:id/mc-mods returns the profile\'s installed mods (empty by default)', async () => {
      const res = await request('/api/servers/mc1/mc-mods')
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toEqual([])
    })

    it('GET /api/servers/:id/mc-mods 404s for an unknown server', async () => {
      const res = await request('/api/servers/nope/mc-mods')
      expect(res.status).toBe(404)
    })

    // mc1 is serverType 'vanilla' in the mock profile - no mod/plugin ecosystem to search,
    // so every mod-search-adjacent action should fail with that same clear error rather than
    // attempting a real Modrinth/CurseForge network call.
    it('GET /api/servers/:id/mc-mods/search fails clearly for a server type with no mod ecosystem', async () => {
      const res = await request('/api/servers/mc1/mc-mods/search?q=anything')
      expect(res.status).toBe(400)
      expect(JSON.parse(res.body).error).toMatch(/no mod\/plugin ecosystem/)
    })

    it('POST /api/servers/:id/mc-mods/rescan fails clearly for a server type with no mod ecosystem', async () => {
      const res = await request('/api/servers/mc1/mc-mods/rescan', { method: 'POST' })
      expect(res.status).toBe(400)
      expect(JSON.parse(res.body).error).toMatch(/no mod\/plugin ecosystem/)
    })

    it('POST /api/servers/:id/mc-mods/install fails clearly for a server type with no mod ecosystem', async () => {
      const res = await request('/api/servers/mc1/mc-mods/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'modrinth', projectId: 'abc123' })
      })
      expect(res.status).toBe(400)
      expect(JSON.parse(res.body).error).toMatch(/no mod\/plugin ecosystem/)
    })

    it('POST /api/servers/:id/mc-mods/remove on an unknown projectId is a harmless no-op', async () => {
      const res = await request('/api/servers/mc1/mc-mods/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'does-not-exist' })
      })
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ ok: true, installedMods: [] })
    })

    it('POST /api/servers/:id/mc-mods/enabled on an unknown projectId is a harmless no-op', async () => {
      const res = await request('/api/servers/mc1/mc-mods/enabled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'does-not-exist', enabled: true })
      })
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ ok: true, installedMods: [] })
    })
  })
})

describe('web dashboard HTTP server, auth enabled', () => {
  const CERTS_DIR = path.join(os.tmpdir(), `web-dashboard-test-certs-${process.pid}`)
  let globalAdminToken = ''
  let adminToken = ''
  let moderatorToken = ''
  let readonlyToken = ''
  let readonlyApiKey = ''
  let moderatorApiKey = ''

  beforeAll(async () => {
    const globalAdminId = generateApiKeyId()
    const globalAdminSecret = generateApiKeySecret()
    const adminId = generateApiKeyId()
    const adminSecret = generateApiKeySecret()
    const moderatorId = generateApiKeyId()
    const moderatorSecret = generateApiKeySecret()
    const readonlyId = generateApiKeyId()
    const readonlySecret = generateApiKeySecret()
    mockAccessTokens = [
      {
        id: globalAdminId,
        label: 'Global Admin token',
        secretHash: await hashPassword(globalAdminSecret),
        role: 'globalAdmin',
        profileIds: null,
        createdAt: Date.now()
      },
      {
        id: adminId,
        label: 'Admin token',
        secretHash: await hashPassword(adminSecret),
        role: 'admin',
        profileIds: null,
        createdAt: Date.now()
      },
      {
        id: moderatorId,
        label: 'Moderator token',
        secretHash: await hashPassword(moderatorSecret),
        role: 'moderator',
        profileIds: null,
        createdAt: Date.now()
      },
      {
        id: readonlyId,
        label: 'Readonly token',
        secretHash: await hashPassword(readonlySecret),
        role: 'readonly',
        profileIds: null,
        createdAt: Date.now()
      }
    ]
    globalAdminToken = buildApiKey(globalAdminId, globalAdminSecret)
    adminToken = buildApiKey(adminId, adminSecret)
    moderatorToken = buildApiKey(moderatorId, moderatorSecret)
    readonlyToken = buildApiKey(readonlyId, readonlySecret)

    const readonlyKeyId = generateApiKeyId()
    const readonlyKeySecret = generateApiKeySecret()
    const moderatorKeyId = generateApiKeyId()
    const moderatorKeySecret = generateApiKeySecret()
    mockApiKeys = [
      {
        id: readonlyKeyId,
        label: 'Test readonly bot',
        secretHash: await hashPassword(readonlyKeySecret),
        role: 'readonly',
        createdAt: Date.now()
      },
      {
        id: moderatorKeyId,
        label: 'Test moderator bot',
        secretHash: await hashPassword(moderatorKeySecret),
        role: 'moderator',
        createdAt: Date.now()
      }
    ]
    readonlyApiKey = buildApiKey(readonlyKeyId, readonlyKeySecret)
    moderatorApiKey = buildApiKey(moderatorKeyId, moderatorKeySecret)
    // getOrCreateCert() resolves its cert folder off settings.dataDir - point it at a real
    // tmp dir instead of the default (Documents/ARK Server Manager via Electron's `app`,
    // which isn't available outside a real Electron process).
    mockSettings = { ...mockSettings, webDashboardAuthEnabled: true, dataDir: CERTS_DIR }
    startWebDashboard(AUTH_PORT, '127.0.0.1')
  })

  afterAll(() => {
    stopWebDashboard()
    mockSettings = { ...mockSettings, webDashboardAuthEnabled: false, dataDir: DATA_DIR }
    mockAccessTokens = []
    mockApiKeys = []
    fs.rmSync(CERTS_DIR, { recursive: true, force: true })
  })

  it('always serves the same dashboard page, with window.__authRequired set', async () => {
    const res = await authRequest('/')
    expect(res.status).toBe(200)
    expect(res.body).toContain('<title>Bober Server Manager - Web Console</title>')
    expect(res.body).toContain('window.__authRequired = true;')
  })

  it('401s an API route with no token', async () => {
    const res = await authRequest('/api/servers')
    expect(res.status).toBe(401)
  })

  it('allows a readonly access token to read /api/servers via Authorization: Bearer', async () => {
    const res = await authRequest('/api/servers', { headers: { Authorization: `Bearer ${readonlyToken}` } })
    expect(res.status).toBe(200)
  })

  it('blocks a readonly access token from starting a server', async () => {
    const res = await authRequest('/api/servers/p1/start', {
      method: 'POST',
      headers: { Authorization: `Bearer ${readonlyToken}` }
    })
    expect(res.status).toBe(403)
  })

  it('allows a moderator access token to start a server', async () => {
    const res = await authRequest('/api/servers/p1/start', {
      method: 'POST',
      headers: { Authorization: `Bearer ${moderatorToken}` }
    })
    expect(res.status).toBe(200)
  })

  it('blocks a moderator access token from deleting a backup', async () => {
    const res = await authRequest('/api/servers/p1/backups/delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${moderatorToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: '/tmp/does-not-matter.zip' })
    })
    expect(res.status).toBe(403)
  })

  it('allows an admin access token to delete a backup', async () => {
    const res = await authRequest('/api/servers/p1/backups/delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: '/tmp/does-not-matter.zip' })
    })
    expect(res.status).toBe(200)
  })

  it('blocks a moderator access token from reading the admin-only remote-control profile route', async () => {
    const res = await authRequest('/api/servers/p1/profile', {
      headers: { Authorization: `Bearer ${moderatorToken}` }
    })
    expect(res.status).toBe(403)
  })

  it('allows an admin access token to read and save the profile route', async () => {
    const getRes = await authRequest('/api/servers/p1/profile', {
      headers: { Authorization: `Bearer ${adminToken}` }
    })
    expect(getRes.status).toBe(200)

    const postRes = await authRequest('/api/servers/p1/profile', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ extraArgs: '-clusterid=test' })
    })
    expect(postRes.status).toBe(200)
    expect(JSON.parse(postRes.body).profile.extraArgs).toBe('-clusterid=test')
  })

  it('blocks a readonly access token from the moderator-accessible Server Management route', async () => {
    const res = await authRequest('/api/servers/p1/servermanagement', {
      headers: { Authorization: `Bearer ${readonlyToken}` }
    })
    expect(res.status).toBe(403)
  })

  // Minecraft's own tabs: MC Start Settings and MC Mods stay admin+ only (same tier as ARK's
  // Settings/Mods); MC Server Settings/MC Backup/MC Server Management are moderator+.
  it('blocks a moderator access token from the admin-only mc-startsettings route', async () => {
    const res = await authRequest('/api/servers/mc1/mc-startsettings', {
      headers: { Authorization: `Bearer ${moderatorToken}` }
    })
    expect(res.status).toBe(403)
  })

  it('allows an admin access token to read mc-startsettings', async () => {
    const res = await authRequest('/api/servers/mc1/mc-startsettings', {
      headers: { Authorization: `Bearer ${adminToken}` }
    })
    expect(res.status).toBe(200)
  })

  it('blocks a moderator access token from the admin-only mc-mods route', async () => {
    const res = await authRequest('/api/servers/mc1/mc-mods', {
      headers: { Authorization: `Bearer ${moderatorToken}` }
    })
    expect(res.status).toBe(403)
  })

  it('allows an admin access token to read mc-mods', async () => {
    const res = await authRequest('/api/servers/mc1/mc-mods', {
      headers: { Authorization: `Bearer ${adminToken}` }
    })
    expect(res.status).toBe(200)
  })

  it('blocks a readonly access token from the moderator-accessible mc-serversettings route', async () => {
    const res = await authRequest('/api/servers/mc1/mc-serversettings', {
      headers: { Authorization: `Bearer ${readonlyToken}` }
    })
    expect(res.status).toBe(403)
  })

  it('allows a moderator access token to read mc-serversettings', async () => {
    const res = await authRequest('/api/servers/mc1/mc-serversettings', {
      headers: { Authorization: `Bearer ${moderatorToken}` }
    })
    expect(res.status).toBe(200)
  })

  it('blocks a readonly access token from the moderator-accessible mc-management route', async () => {
    const res = await authRequest('/api/servers/mc1/mc-management', {
      headers: { Authorization: `Bearer ${readonlyToken}` }
    })
    expect(res.status).toBe(403)
  })

  it('allows a moderator access token to read mc-management', async () => {
    const res = await authRequest('/api/servers/mc1/mc-management', {
      headers: { Authorization: `Bearer ${moderatorToken}` }
    })
    expect(res.status).toBe(200)
  })

  it('allows a readonly access token to list mc-backups but blocks it from creating one', async () => {
    const list = await authRequest('/api/servers/mc1/mc-backups', {
      headers: { Authorization: `Bearer ${readonlyToken}` }
    })
    expect(list.status).toBe(200)

    const create = await authRequest('/api/servers/mc1/mc-backups', {
      method: 'POST',
      headers: { Authorization: `Bearer ${readonlyToken}` }
    })
    expect(create.status).toBe(403)
  })

  it('blocks a moderator access token from deleting an mc-backup', async () => {
    const res = await authRequest('/api/servers/mc1/mc-backups/delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${moderatorToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: '/tmp/does-not-matter.zip' })
    })
    expect(res.status).toBe(403)
  })

  it('allows a moderator access token to read and save the Server Management route', async () => {
    const getRes = await authRequest('/api/servers/p1/servermanagement', {
      headers: { Authorization: `Bearer ${moderatorToken}` }
    })
    expect(getRes.status).toBe(200)

    const postRes = await authRequest('/api/servers/p1/servermanagement', {
      method: 'POST',
      headers: { Authorization: `Bearer ${moderatorToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledDinoWipeEnabled: true })
    })
    expect(postRes.status).toBe(200)
    expect(JSON.parse(postRes.body).profile.scheduledDinoWipeEnabled).toBe(true)
  })

  it('reports the caller role via GET /api/whoami', async () => {
    const res = await authRequest('/api/whoami', { headers: { Authorization: `Bearer ${adminToken}` } })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ role: 'admin' })
  })

  it('401s the SSE stream with no token', async () => {
    const res = await authRequest('/api/servers/p1/events/stream')
    expect(res.status).toBe(401)
  })

  it('allows the SSE stream via a ?token= query parameter (EventSource cannot set headers)', async () => {
    // Doesn't use authRequest() - a successful SSE connection never ends on its own (see
    // openStream() above), so waiting for the response body to finish would hang forever.
    // Only the status from the initial response is needed here.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = https.request(
        {
          host: '127.0.0.1',
          port: AUTH_PORT,
          path: `/api/servers/p1/events/stream?token=${encodeURIComponent(readonlyToken)}`,
          rejectUnauthorized: false
        },
        (res) => {
          resolve(res.statusCode)
          req.destroy()
        }
      )
      req.on('error', (err) => {
        // Destroying the request after resolving above triggers a benign socket error -
        // ignore it once the status has already been captured.
        if (req.destroyed) return
        reject(err)
      })
      req.end()
    })
    expect(status).toBe(200)
  })

  it('allows a readonly API key to read /api/servers via Authorization: Bearer', async () => {
    const res = await authRequest('/api/servers', { headers: { Authorization: `Bearer ${readonlyApiKey}` } })
    expect(res.status).toBe(200)
  })

  it('blocks a readonly API key from starting a server', async () => {
    const res = await authRequest('/api/servers/p1/start', {
      method: 'POST',
      headers: { Authorization: `Bearer ${readonlyApiKey}` }
    })
    expect(res.status).toBe(403)
  })

  it('allows a moderator API key to start a server', async () => {
    const res = await authRequest('/api/servers/p1/start', {
      method: 'POST',
      headers: { Authorization: `Bearer ${moderatorApiKey}` }
    })
    expect(res.status).toBe(200)
  })

  it('401s a made-up token', async () => {
    const res = await authRequest('/api/servers', { headers: { Authorization: 'Bearer ark_deadbeef_deadbeef' } })
    expect(res.status).toBe(401)
  })

  it('401s a malformed Authorization header', async () => {
    const res = await authRequest('/api/servers', { headers: { Authorization: 'not-a-bearer-token' } })
    expect(res.status).toBe(401)
  })

  describe('a token scoped to a single server', () => {
    let scopedToken = ''

    beforeAll(async () => {
      const id = generateApiKeyId()
      const secret = generateApiKeySecret()
      mockAccessTokens.push({
        id,
        label: 'Scoped to p2',
        secretHash: await hashPassword(secret),
        role: 'admin',
        profileIds: ['p2'],
        createdAt: Date.now()
      })
      scopedToken = buildApiKey(id, secret)
    })

    afterAll(() => {
      mockAccessTokens = mockAccessTokens.filter((t) => t.label !== 'Scoped to p2')
    })

    it('only lists the server it is scoped to via GET /api/servers', async () => {
      const res = await authRequest('/api/servers', { headers: { Authorization: `Bearer ${scopedToken}` } })
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body).map((s: { id: string }) => s.id)).toEqual(['p2'])
    })

    it('404s an action route for a server outside its scope', async () => {
      const res = await authRequest('/api/servers/p1/start', {
        method: 'POST',
        headers: { Authorization: `Bearer ${scopedToken}` }
      })
      expect(res.status).toBe(404)
    })

    it('allows the same action for the server inside its scope', async () => {
      const res = await authRequest('/api/servers/p2/start', {
        method: 'POST',
        headers: { Authorization: `Bearer ${scopedToken}` }
      })
      expect(res.status).toBe(200)
    })

    it('excludes the out-of-scope server from a merged group backlog', async () => {
      const res = await authRequest('/api/groups/_ungrouped_/events', {
        headers: { Authorization: `Bearer ${scopedToken}` }
      })
      expect(res.status).toBe(200)
      const profileIds = new Set(JSON.parse(res.body).map((e: { profileId: string }) => e.profileId))
      expect(profileIds.has('p1')).toBe(false)
    })
  })

  // Unlike a plain 'admin' token (above), globalAdmin ignores profileIds entirely - the one
  // role scoping was never meant to restrict, so it always behaves as if unscoped regardless
  // of what's stored on the token.
  describe('a globalAdmin token scoped to a single server', () => {
    let scopedGlobalAdminToken = ''

    beforeAll(async () => {
      const id = generateApiKeyId()
      const secret = generateApiKeySecret()
      mockAccessTokens.push({
        id,
        label: 'globalAdmin scoped to p2',
        secretHash: await hashPassword(secret),
        role: 'globalAdmin',
        profileIds: ['p2'],
        createdAt: Date.now()
      })
      scopedGlobalAdminToken = buildApiKey(id, secret)
    })

    afterAll(() => {
      mockAccessTokens = mockAccessTokens.filter((t) => t.label !== 'globalAdmin scoped to p2')
    })

    it('still lists every server via GET /api/servers, ignoring profileIds', async () => {
      const res = await authRequest('/api/servers', { headers: { Authorization: `Bearer ${scopedGlobalAdminToken}` } })
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body).map((s: { id: string }) => s.id).sort()).toEqual(['mc1', 'p1', 'p2'])
    })

    it('still acts on a server outside its nominal scope', async () => {
      const res = await authRequest('/api/servers/p1/start', {
        method: 'POST',
        headers: { Authorization: `Bearer ${scopedGlobalAdminToken}` }
      })
      expect(res.status).toBe(200)
    })
  })
})
