import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { IncomingMessage } from 'node:http'
import {
  hashPassword,
  verifyPassword,
  createSession,
  getSession,
  destroySession,
  roleAtLeast,
  isRateLimited,
  recordLoginFailure,
  recordLoginSuccess,
  generateApiKeyId,
  generateApiKeySecret,
  buildApiKey,
  parseApiKey,
  getApiKeyFromRequest
} from '../src/main/lib/auth'

describe('hashPassword / verifyPassword', () => {
  it('round-trips a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true)
  })

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    await expect(verifyPassword('wrong password', hash)).resolves.toBe(false)
  })

  it('produces a different hash each time (random salt)', async () => {
    const a = await hashPassword('same password')
    const b = await hashPassword('same password')
    expect(a).not.toBe(b)
  })

  it('rejects a malformed stored hash instead of throwing', async () => {
    await expect(verifyPassword('anything', 'not-a-real-hash')).resolves.toBe(false)
  })
})

describe('sessions', () => {
  it('creates a session that can be looked up by its token', () => {
    const token = createSession('alice', 'operator')
    expect(getSession(token)).toMatchObject({ username: 'alice', role: 'operator' })
  })

  it('returns null for an unknown token', () => {
    expect(getSession('does-not-exist')).toBeNull()
  })

  it('returns null for a null token', () => {
    expect(getSession(null)).toBeNull()
  })

  it('destroying a session makes it unresolvable', () => {
    const token = createSession('bob', 'admin')
    destroySession(token)
    expect(getSession(token)).toBeNull()
  })
})

describe('roleAtLeast', () => {
  it('ranks readonly < operator < admin', () => {
    expect(roleAtLeast('readonly', 'readonly')).toBe(true)
    expect(roleAtLeast('readonly', 'operator')).toBe(false)
    expect(roleAtLeast('operator', 'readonly')).toBe(true)
    expect(roleAtLeast('operator', 'admin')).toBe(false)
    expect(roleAtLeast('admin', 'operator')).toBe(true)
    expect(roleAtLeast('admin', 'admin')).toBe(true)
  })
})

describe('API keys', () => {
  it('builds a key from an id and secret, and parses it back out', () => {
    const id = generateApiKeyId()
    const secret = generateApiKeySecret()
    const key = buildApiKey(id, secret)
    expect(parseApiKey(key)).toEqual({ id, secret })
  })

  it('generates a different id and secret every time', () => {
    expect(generateApiKeyId()).not.toBe(generateApiKeyId())
    expect(generateApiKeySecret()).not.toBe(generateApiKeySecret())
  })

  it('rejects a key that does not match the expected format', () => {
    expect(parseApiKey('not-a-real-key')).toBeNull()
    expect(parseApiKey('ark_onlyoneparthere')).toBeNull()
    expect(parseApiKey('')).toBeNull()
  })

  it('reads the key out of an Authorization: Bearer header', () => {
    const req = { headers: { authorization: 'Bearer ark_abc123_def456' } } as unknown as IncomingMessage
    expect(getApiKeyFromRequest(req)).toBe('ark_abc123_def456')
  })

  it('returns null when there is no Authorization header', () => {
    const req = { headers: {} } as unknown as IncomingMessage
    expect(getApiKeyFromRequest(req)).toBeNull()
  })

  it('returns null for a non-Bearer Authorization header', () => {
    const req = { headers: { authorization: 'Basic dXNlcjpwYXNz' } } as unknown as IncomingMessage
    expect(getApiKeyFromRequest(req)).toBeNull()
  })
})

describe('login rate limiting', () => {
  const ip = '203.0.113.7'

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    recordLoginSuccess(ip)
    vi.useRealTimers()
  })

  it('is not limited before any failures', () => {
    expect(isRateLimited(ip)).toBe(false)
  })

  it('locks out after enough failures within the window', () => {
    for (let i = 0; i < 8; i++) recordLoginFailure(ip)
    expect(isRateLimited(ip)).toBe(true)
  })

  it('a success clears previous failures', () => {
    for (let i = 0; i < 7; i++) recordLoginFailure(ip)
    recordLoginSuccess(ip)
    expect(isRateLimited(ip)).toBe(false)
  })

  it('the lockout expires after the window passes', () => {
    for (let i = 0; i < 8; i++) recordLoginFailure(ip)
    expect(isRateLimited(ip)).toBe(true)
    vi.advanceTimersByTime(16 * 60 * 1000)
    expect(isRateLimited(ip)).toBe(false)
  })
})
