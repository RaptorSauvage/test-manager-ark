import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { PLAYER_NAME_OPEN, PLAYER_NAME_CLOSE } from '../src/main/lib/logEvents'
import type { WebDashboardAccount, WebDashboardApiKey } from '../shared/types'

const EMPTY_INSTALL_DIR = path.join(os.tmpdir(), `web-dashboard-test-empty-${process.pid}`)
const LOGGED_INSTALL_DIR = path.join(os.tmpdir(), `web-dashboard-test-logged-${process.pid}`)
const PLAYER = `${PLAYER_NAME_OPEN}LeRaptorSauvage${PLAYER_NAME_CLOSE}`

let mockSettings = {
  steamCmdPath: '',
  dataDir: '',
  webDashboardEnabled: false,
  webDashboardPort: 47091,
  webDashboardHost: '127.0.0.1',
  webDashboardDisabledLabels: [] as string[],
  launchOnStartup: false,
  webDashboardAuthEnabled: false
}

let mockAccounts: WebDashboardAccount[] = []
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
  listWebDashboardAccounts: () => mockAccounts,
  saveWebDashboardAccount: (account: WebDashboardAccount) => {
    const idx = mockAccounts.findIndex((a) => a.id === account.id)
    if (idx >= 0) mockAccounts[idx] = account
    else mockAccounts.push(account)
    return mockAccounts
  },
  deleteWebDashboardAccount: (id: string) => {
    mockAccounts = mockAccounts.filter((a) => a.id !== id)
    return mockAccounts
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
        ts: '21:25:23'
      }
    ])
  })

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
  let adminCookie = ''
  let operatorCookie = ''
  let readonlyCookie = ''
  let readonlyApiKey = ''
  let operatorApiKey = ''

  async function login(username: string, password: string): Promise<{ status: number; cookie: string }> {
    const res = await authRequest('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    const setCookie = res.headers['set-cookie']?.[0] ?? ''
    return { status: res.status, cookie: setCookie.split(';')[0] }
  }

  beforeAll(async () => {
    mockAccounts = [
      { id: 'a1', username: 'admin', passwordHash: await hashPassword('adminpass'), role: 'admin' },
      { id: 'a2', username: 'operator', passwordHash: await hashPassword('operatorpass'), role: 'operator' },
      { id: 'a3', username: 'viewer', passwordHash: await hashPassword('viewerpass'), role: 'readonly' }
    ]
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
    adminCookie = (await login('admin', 'adminpass')).cookie
    operatorCookie = (await login('operator', 'operatorpass')).cookie
    readonlyCookie = (await login('viewer', 'viewerpass')).cookie
  })

  afterAll(() => {
    stopWebDashboard()
    mockSettings = { ...mockSettings, webDashboardAuthEnabled: false, dataDir: '' }
    mockAccounts = []
    mockApiKeys = []
    fs.rmSync(CERTS_DIR, { recursive: true, force: true })
  })

  it('serves the login page when there is no session', async () => {
    const res = await authRequest('/')
    expect(res.status).toBe(200)
    expect(res.body).toContain('<title>ARK Server Manager - Login</title>')
  })

  it('rejects a wrong password', async () => {
    const res = await authRequest('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' })
    })
    expect(res.status).toBe(401)
  })

  it('serves the dashboard page with the role injected once logged in', async () => {
    const res = await authRequest('/', { headers: { Cookie: adminCookie } })
    expect(res.status).toBe(200)
    expect(res.body).toContain('<title>ARK Server Manager - Web Console</title>')
    expect(res.body).toContain('window.__role = "admin";')
  })

  it('401s an API route with no session', async () => {
    const res = await authRequest('/api/servers')
    expect(res.status).toBe(401)
  })

  it('allows a readonly session to read /api/servers', async () => {
    const res = await authRequest('/api/servers', { headers: { Cookie: readonlyCookie } })
    expect(res.status).toBe(200)
  })

  it('blocks a readonly session from starting a server', async () => {
    const res = await authRequest('/api/servers/p1/start', { method: 'POST', headers: { Cookie: readonlyCookie } })
    expect(res.status).toBe(403)
  })

  it('allows an operator session to start a server', async () => {
    const res = await authRequest('/api/servers/p1/start', { method: 'POST', headers: { Cookie: operatorCookie } })
    expect(res.status).toBe(200)
  })

  it('blocks an operator session from deleting a backup', async () => {
    const res = await authRequest('/api/servers/p1/backups/delete', {
      method: 'POST',
      headers: { Cookie: operatorCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: '/tmp/does-not-matter.zip' })
    })
    expect(res.status).toBe(403)
  })

  it('allows an admin session to delete a backup', async () => {
    const res = await authRequest('/api/servers/p1/backups/delete', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: '/tmp/does-not-matter.zip' })
    })
    expect(res.status).toBe(200)
  })

  it('401s the SSE stream with no session', async () => {
    const res = await authRequest('/api/servers/p1/events/stream')
    expect(res.status).toBe(401)
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

  it('401s a made-up API key', async () => {
    const res = await authRequest('/api/servers', { headers: { Authorization: 'Bearer ark_deadbeef_deadbeef' } })
    expect(res.status).toBe(401)
  })

  it('401s a malformed Authorization header', async () => {
    const res = await authRequest('/api/servers', { headers: { Authorization: 'not-a-bearer-token' } })
    expect(res.status).toBe(401)
  })

  it('logout clears the session', async () => {
    const logoutRes = await authRequest('/api/logout', { method: 'POST', headers: { Cookie: readonlyCookie } })
    expect(logoutRes.status).toBe(200)
    const afterLogout = await authRequest('/api/servers', { headers: { Cookie: readonlyCookie } })
    expect(afterLogout.status).toBe(401)
  })

  // Deliberately last: this poisons the shared per-IP rate limiter for the rest of the
  // suite (it isn't keyed per-username), so nothing after it can log in fresh.
  it('locks out after repeated failed logins from the same IP', async () => {
    for (let i = 0; i < 8; i++) {
      await authRequest('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: `wrong${i}` })
      })
    }
    const res = await authRequest('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'adminpass' })
    })
    expect(res.status).toBe(429)
  })
})
