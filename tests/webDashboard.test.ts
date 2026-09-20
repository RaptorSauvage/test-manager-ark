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
  webDashboardAuthEnabled: false
}

let mockAccessTokens: WebDashboardAccessToken[] = []
let mockApiKeys: WebDashboardApiKey[] = []

vi.mock('../src/main/store', () => ({
  listProfiles: () => [
    {
      id: 'p1',
      name: 'Test Server',
      installDir: EMPTY_INSTALL_DIR,
      startOnManagerLaunch: false,
      hidden: false,
      group: '',
      backupDir: '',
      maxBackups: 10,
      backupScheduleEnabled: false,
      backupSchedule: ''
    },
    {
      id: 'p2',
      name: 'Logged Server',
      installDir: LOGGED_INSTALL_DIR,
      startOnManagerLaunch: false,
      hidden: false,
      group: '',
      backupDir: '',
      maxBackups: 10,
      backupScheduleEnabled: false,
      backupSchedule: ''
    }
  ],
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
vi.mock('../src/main/lib/serverActions', () => ({
  doStartServer: vi.fn((profile: { id: string }) => ({ profileId: profile.id, state: 'starting' })),
  doStopServer: vi.fn(async (profile: { id: string }) => ({ profileId: profile.id, state: 'stopping' })),
  doStopServerConfirmSave: vi.fn(async (_profile: { id: string }) => ({ saved: true })),
  doRestartServer: vi.fn(async (profile: { id: string }) => ({ profileId: profile.id, state: 'starting' })),
  doRestartServerConfirmSave: vi.fn(async (_profile: { id: string }) => ({ saved: true })),
  doUpdateServer: vi.fn(async () => {}),
  doStopUpdateRestart: vi.fn(async () => {})
}))

import { startWebDashboard, stopWebDashboard, getWebDashboardStatus, sortProfilesForDisplay } from '../src/main/lib/webDashboard'
import type { ServerProfile } from '../shared/types'
import * as serverActions from '../src/main/lib/serverActions'
import { serverEvents } from '../src/main/lib/serverProcess'
import { hashPassword, generateApiKeyId, generateApiKeySecret, buildApiKey } from '../src/main/lib/auth'
import { setCachedGameVersion } from '../src/main/lib/serverVersion'

const PORT = 47091

function request(
  reqPath: string,
  options: http.RequestOptions & { body?: string } = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: reqPath, ...options }, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
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
    startWebDashboard(PORT, '127.0.0.1')
  })

  afterAll(() => {
    stopWebDashboard()
    fs.rmSync(EMPTY_INSTALL_DIR, { recursive: true, force: true })
    fs.rmSync(LOGGED_INSTALL_DIR, { recursive: true, force: true })
  })

  it('serves the dashboard page at /', async () => {
    const res = await request('/')
    expect(res.status).toBe(200)
    expect(res.body).toContain('<title>ARK Server Manager - Web Console</title>')
  })

  it('lists servers with their live status', async () => {
    const res = await request('/api/servers')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual([
      {
        id: 'p1',
        name: 'Test Server',
        group: '',
        state: 'running',
        players: ['Alice'],
        cpu: 12.3,
        memoryMB: 512,
        startedAt: null,
        gameVersion: null
      },
      {
        id: 'p2',
        name: 'Logged Server',
        group: '',
        state: 'running',
        players: ['Alice'],
        cpu: 12.3,
        memoryMB: 512,
        startedAt: null,
        gameVersion: '92.28'
      }
    ])
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
})

describe('web dashboard HTTP server, auth enabled', () => {
  const CERTS_DIR = path.join(os.tmpdir(), `web-dashboard-test-certs-${process.pid}`)
  let adminToken = ''
  let operatorToken = ''
  let readonlyToken = ''
  let readonlyApiKey = ''
  let operatorApiKey = ''

  beforeAll(async () => {
    const adminId = generateApiKeyId()
    const adminSecret = generateApiKeySecret()
    const operatorId = generateApiKeyId()
    const operatorSecret = generateApiKeySecret()
    const readonlyId = generateApiKeyId()
    const readonlySecret = generateApiKeySecret()
    mockAccessTokens = [
      { id: adminId, label: 'Admin token', secretHash: await hashPassword(adminSecret), role: 'admin', createdAt: Date.now() },
      {
        id: operatorId,
        label: 'Operator token',
        secretHash: await hashPassword(operatorSecret),
        role: 'operator',
        createdAt: Date.now()
      },
      {
        id: readonlyId,
        label: 'Readonly token',
        secretHash: await hashPassword(readonlySecret),
        role: 'readonly',
        createdAt: Date.now()
      }
    ]
    adminToken = buildApiKey(adminId, adminSecret)
    operatorToken = buildApiKey(operatorId, operatorSecret)
    readonlyToken = buildApiKey(readonlyId, readonlySecret)

    const readonlyKeyId = generateApiKeyId()
    const readonlyKeySecret = generateApiKeySecret()
    const operatorKeyId = generateApiKeyId()
    const operatorKeySecret = generateApiKeySecret()
    mockApiKeys = [
      {
        id: readonlyKeyId,
        label: 'Test readonly bot',
        secretHash: await hashPassword(readonlyKeySecret),
        role: 'readonly',
        createdAt: Date.now()
      },
      {
        id: operatorKeyId,
        label: 'Test operator bot',
        secretHash: await hashPassword(operatorKeySecret),
        role: 'operator',
        createdAt: Date.now()
      }
    ]
    readonlyApiKey = buildApiKey(readonlyKeyId, readonlyKeySecret)
    operatorApiKey = buildApiKey(operatorKeyId, operatorKeySecret)
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
    expect(res.body).toContain('<title>ARK Server Manager - Web Console</title>')
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

  it('allows an operator access token to start a server', async () => {
    const res = await authRequest('/api/servers/p1/start', {
      method: 'POST',
      headers: { Authorization: `Bearer ${operatorToken}` }
    })
    expect(res.status).toBe(200)
  })

  it('blocks an operator access token from deleting a backup', async () => {
    const res = await authRequest('/api/servers/p1/backups/delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${operatorToken}`, 'Content-Type': 'application/json' },
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

  it('allows an operator API key to start a server', async () => {
    const res = await authRequest('/api/servers/p1/start', {
      method: 'POST',
      headers: { Authorization: `Bearer ${operatorApiKey}` }
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
})
