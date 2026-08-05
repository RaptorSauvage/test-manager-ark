import type { IncomingMessage } from 'node:http'
import { randomBytes, randomUUID, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import type { WebDashboardRole } from '@shared/types'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 64

/** Promise wrapper around crypto.scrypt - not scryptSync, since this runs on the Electron
 *  main process's single thread, which also handles RCON polling, the process monitor and
 *  every other IPC call; blocking it for ~100ms per attempt would freeze the desktop UI. */
function scryptAsync(password: string, salt: string, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err)
      else resolve(derivedKey)
    })
  })
}

/** Hashes a password with a random salt. The cost parameters are baked into the stored
 *  string so they can be tuned later without stranding existing accounts. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = await scryptAsync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, nStr, rStr, pStr, salt, hashHex] = parts
  const N = Number(nStr)
  const r = Number(rStr)
  const p = Number(pStr)
  const expected = Buffer.from(hashHex, 'hex')
  const derived = await scryptAsync(password, salt, expected.length, { N, r, p })
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

interface Session {
  username: string
  role: WebDashboardRole
  expiresAt: number
}

const SESSION_COOKIE = 'ark_session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

const sessions = new Map<string, Session>()

export function createSession(username: string, role: WebDashboardRole): string {
  const token = randomUUID() + randomBytes(16).toString('hex')
  sessions.set(token, { username, role, expiresAt: Date.now() + SESSION_TTL_MS })
  return token
}

/** Looks up a session by token, dropping and returning null if it's expired - otherwise
 *  slides its expiry forward so an actively-used session doesn't log out mid-session. */
export function getSession(token: string | null): Session | null {
  if (!token) return null
  const session = sessions.get(token)
  if (!session) return null
  if (session.expiresAt < Date.now()) {
    sessions.delete(token)
    return null
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS
  return session
}

export function destroySession(token: string | null): void {
  if (token) sessions.delete(token)
}

const ROLE_RANK: Record<WebDashboardRole, number> = { readonly: 0, operator: 1, admin: 2 }

export function roleAtLeast(role: WebDashboardRole, min: WebDashboardRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min]
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie
  if (!header) return {}
  const result: Record<string, string> = {}
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=')
    if (idx === -1) continue
    const key = pair.slice(0, idx).trim()
    const value = pair.slice(idx + 1).trim()
    if (key) result[key] = decodeURIComponent(value)
  }
  return result
}

export function getSessionTokenFromRequest(req: IncomingMessage): string | null {
  return parseCookies(req)[SESSION_COOKIE] ?? null
}

export function buildSessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
}

export function buildExpiredSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
}

const RATE_LIMIT_MAX_FAILURES = 8
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000

interface RateLimitEntry {
  failures: number
  windowStart: number
}

const loginAttempts = new Map<string, RateLimitEntry>()

/** True if this IP has failed to log in too many times recently and should be blocked
 *  before even checking credentials - a lightweight brute-force mitigation now that the
 *  dashboard may be reachable from outside the LAN. */
export function isRateLimited(ip: string): boolean {
  const entry = loginAttempts.get(ip)
  if (!entry) return false
  if (Date.now() - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    loginAttempts.delete(ip)
    return false
  }
  return entry.failures >= RATE_LIMIT_MAX_FAILURES
}

export function recordLoginFailure(ip: string): void {
  const entry = loginAttempts.get(ip)
  if (!entry || Date.now() - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    loginAttempts.set(ip, { failures: 1, windowStart: Date.now() })
  } else {
    entry.failures += 1
  }
}

export function recordLoginSuccess(ip: string): void {
  loginAttempts.delete(ip)
}

const API_KEY_PREFIX = 'ark'

/** Random id embedded in the key itself so a presented key can be looked up directly (by
 *  this id) instead of scanning every stored key's hash to find a match. */
export function generateApiKeyId(): string {
  return randomBytes(6).toString('hex')
}

/** The actual secret half - this is what gets hashed and checked, same as a password. */
export function generateApiKeySecret(): string {
  return randomBytes(24).toString('hex')
}

export function buildApiKey(id: string, secret: string): string {
  return `${API_KEY_PREFIX}_${id}_${secret}`
}

export function parseApiKey(key: string): { id: string; secret: string } | null {
  const match = new RegExp(`^${API_KEY_PREFIX}_([0-9a-f]+)_([0-9a-f]+)$`).exec(key.trim())
  return match ? { id: match[1], secret: match[2] } : null
}

/** Reads the presented API key from an `Authorization: Bearer <key>` header, if any. */
export function getApiKeyFromRequest(req: IncomingMessage): string | null {
  const header = req.headers.authorization
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1] : null
}
