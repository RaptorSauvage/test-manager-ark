import { describe, it, expect } from 'vitest'
import type { IncomingMessage } from 'node:http'
import {
  hashPassword,
  verifyPassword,
  roleAtLeast,
  generateApiKeyId,
  generateApiKeySecret,
  buildApiKey,
  parseApiKey,
  getBearerTokenFromRequest
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

describe('API keys / access tokens (shared ark_<id>_<secret> format)', () => {
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
})

describe('getBearerTokenFromRequest', () => {
  it('reads the token out of an Authorization: Bearer header', () => {
    const req = { headers: { authorization: 'Bearer ark_abc123_def456' }, url: '/api/servers' } as unknown as IncomingMessage
    expect(getBearerTokenFromRequest(req)).toBe('ark_abc123_def456')
  })

  it('falls back to a ?token= query parameter when there is no header', () => {
    const req = { headers: {}, url: '/api/servers/p1/events/stream?token=ark_abc123_def456' } as unknown as IncomingMessage
    expect(getBearerTokenFromRequest(req)).toBe('ark_abc123_def456')
  })

  it('prefers the header over a query parameter when both are present', () => {
    const req = {
      headers: { authorization: 'Bearer ark_header_secret' },
      url: '/api/servers?token=ark_query_secret'
    } as unknown as IncomingMessage
    expect(getBearerTokenFromRequest(req)).toBe('ark_header_secret')
  })

  it('returns null when there is neither a header nor a query parameter', () => {
    const req = { headers: {}, url: '/api/servers' } as unknown as IncomingMessage
    expect(getBearerTokenFromRequest(req)).toBeNull()
  })

  it('returns null for a non-Bearer Authorization header with no query fallback', () => {
    const req = { headers: { authorization: 'Basic dXNlcjpwYXNz' }, url: '/api/servers' } as unknown as IncomingMessage
    expect(getBearerTokenFromRequest(req)).toBeNull()
  })
})
