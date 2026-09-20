import type { IncomingMessage } from 'node:http'
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'
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

/** Hashes a secret (an API key's or access token's random half) with a random salt. The
 *  cost parameters are baked into the stored string so they can be tuned later without
 *  stranding existing keys/tokens. */
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

const ROLE_RANK: Record<WebDashboardRole, number> = { readonly: 0, operator: 1, admin: 2 }

export function roleAtLeast(role: WebDashboardRole, min: WebDashboardRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min]
}

/** Shared `ark_<id>_<secret>` credential format for both WebDashboardApiKey (bots/scripts)
 *  and WebDashboardAccessToken (pasted into a browser) - cryptographically and structurally
 *  identical, just looked up against two separate stored lists by whoever presents one. */
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

/** Reads a presented Bearer credential (an API key or an access token) from the request -
 *  from an `Authorization: Bearer <token>` header if present, otherwise from a `?token=`
 *  query parameter. The query fallback exists only for the browser's `EventSource`
 *  connections, which can't set custom headers - everything else uses the header. */
export function getBearerTokenFromRequest(req: IncomingMessage): string | null {
  const header = req.headers.authorization
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim())
    if (match) return match[1]
  }
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    return url.searchParams.get('token')
  } catch {
    return null
  }
}
