import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import http from 'node:http'

vi.mock('../src/main/store', () => ({
  listProfiles: () => [{ id: 'p1', name: 'Test Server' }]
}))
vi.mock('../src/main/lib/serverProcess', () => ({
  getStatus: () => ({ profileId: 'p1', state: 'running', players: ['Alice'], cpu: 12.3, memoryMB: 512 })
}))
vi.mock('../src/main/lib/rcon', () => ({
  sendRconCommand: async () => ({ ok: true, response: 'pong' })
}))

import { startWebDashboard, stopWebDashboard } from '../src/main/lib/webDashboard'

const PORT = 47091

function request(
  path: string,
  options: http.RequestOptions & { body?: string } = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path, ...options }, (res) => {
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
    startWebDashboard(PORT)
  })

  afterAll(() => {
    stopWebDashboard()
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
      { id: 'p1', name: 'Test Server', state: 'running', players: ['Alice'], cpu: 12.3, memoryMB: 512 }
    ])
  })

  it('returns the buffered events for a server (empty when none captured)', async () => {
    const res = await request('/api/servers/p1/events')
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual([])
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
})
