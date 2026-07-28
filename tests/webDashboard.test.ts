import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const EMPTY_INSTALL_DIR = path.join(os.tmpdir(), `web-dashboard-test-empty-${process.pid}`)
const LOGGED_INSTALL_DIR = path.join(os.tmpdir(), `web-dashboard-test-logged-${process.pid}`)

let mockSettings = {
  steamCmdPath: '',
  dataDir: '',
  webDashboardEnabled: false,
  webDashboardPort: 47091,
  webDashboardHost: '127.0.0.1',
  webDashboardDisabledLabels: [] as string[]
}

vi.mock('../src/main/store', () => ({
  listProfiles: () => [
    { id: 'p1', name: 'Test Server', installDir: EMPTY_INSTALL_DIR },
    { id: 'p2', name: 'Logged Server', installDir: LOGGED_INSTALL_DIR }
  ],
  getSettings: () => mockSettings,
  saveSettings: (settings: typeof mockSettings) => {
    mockSettings = settings
    return mockSettings
  }
}))
vi.mock('../src/main/lib/serverProcess', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/lib/serverProcess')>()
  return {
    ...actual,
    getStatus: () => ({ profileId: 'p1', state: 'running', players: ['Alice'], cpu: 12.3, memoryMB: 512 })
  }
})
vi.mock('../src/main/lib/rcon', () => ({
  sendRconCommand: async () => ({ ok: true, response: 'pong' })
}))

import { startWebDashboard, stopWebDashboard, getWebDashboardStatus } from '../src/main/lib/webDashboard'

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

describe('web dashboard HTTP server', () => {
  beforeAll(() => {
    const logsDir = path.join(LOGGED_INSTALL_DIR, 'ShooterGame', 'Saved', 'Logs')
    fs.mkdirSync(logsDir, { recursive: true })
    fs.writeFileSync(
      path.join(logsDir, 'ShooterGame.log'),
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
      { id: 'p1', name: 'Test Server', state: 'running', players: ['Alice'], cpu: 12.3, memoryMB: 512 },
      { id: 'p2', name: 'Logged Server', state: 'running', players: ['Alice'], cpu: 12.3, memoryMB: 512 }
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
        text: 'LeRaptorSauvage joined the server (ID: 0002dbe9ab20413e9b8e7e1562b76868)',
        ts: '21:25:23'
      }
    ])
  })

  it('sends an RCON command through and returns its result', async () => {
    const res = await request('/api/servers/p1/rcon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'ListPlayers' })
    })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true, response: 'pong' })
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
