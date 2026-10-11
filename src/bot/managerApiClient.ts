import { Agent } from 'undici'
import type { DiscordBotConfig, ManagerServerInfo } from '@shared/discordBot'
import { log } from './logging'

/** Raised for any failure talking to the Manager's own Web Dashboard API - caught at the call
 *  site in every command and turned into a clear FR error message, same as the standalone
 *  bot's ManagerApiError. */
export class ManagerApiError extends Error {}

// Tolerates the Manager's own self-signed certificate (see discordBotRuntime.ts's own doc
// comment on managerApiUrl) - this agent is only ever pointed at the Manager's own
// `managerApiUrl` from this bot's config, never a user-supplied or remote URL, so skipping
// verification here doesn't expose this bot to a wider MITM surface than it already has by
// trusting that config value at all.
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } })

function headersFor(config: DiscordBotConfig): Record<string, string> {
  if (!config.managerApiKey) return {}
  return { Authorization: `Bearer ${config.managerApiKey}` }
}

async function managerApiRequest(config: DiscordBotConfig, method: string, path: string, body?: unknown): Promise<unknown> {
  if (!config.managerApiUrl) {
    throw new ManagerApiError("L'URL du Web Dashboard du Manager n'est pas configurée.")
  }
  const url = `${config.managerApiUrl}${path}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.managerApiTimeoutMs)
  try {
    const response = await fetch(url, {
      method,
      headers: { ...headersFor(config), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      // undici's fetch accepts a `dispatcher` extension beyond the standard RequestInit
      // shape, used here to reach the Manager's own HTTPS self-signed certificate without
      // failing TLS verification (see insecureAgent's own doc comment).
      dispatcher: config.managerApiUrl.startsWith('https:') ? insecureAgent : undefined
    })

    let data: unknown = {}
    try {
      data = await response.json()
    } catch {
      data = {}
    }

    if (response.status === 401) {
      throw new ManagerApiError(
        "Clé API du Manager manquante ou invalide (401) - réactive/recrée l'intégration Discord dans Settings."
      )
    }
    if (response.status === 403) {
      throw new ManagerApiError(
        'Permissions insuffisantes (403) - cette action nécessite une clé avec le rôle "moderator" ou plus.'
      )
    }
    if (response.status >= 400) {
      const message = typeof data === 'object' && data && 'error' in data ? String((data as { error: unknown }).error) : null
      throw new ManagerApiError(message || `HTTP ${response.status}`)
    }
    return data
  } catch (err) {
    if (err instanceof ManagerApiError) throw err
    if ((err as Error).name === 'AbortError') {
      throw new ManagerApiError('ARK Server Manager : délai d\'attente dépassé')
    }
    // undici's fetch wraps every network-level failure (connection refused, DNS, TLS...) in
    // a generic "TypeError: fetch failed" - the actually useful reason (e.g. "connect
    // ECONNREFUSED 127.0.0.1:8090") lives on `err.cause`, not `err.message`, and was
    // silently dropped here before, making every real failure look identical in the logs.
    const cause = (err as { cause?: unknown }).cause
    const causeMessage = cause instanceof Error ? cause.message : cause ? String(cause) : null
    throw new ManagerApiError(
      `ARK Server Manager injoignable (${(err as Error).message}${causeMessage ? ` : ${causeMessage}` : ''})`
    )
  } finally {
    clearTimeout(timeout)
  }
}

export async function managerApiGet(config: DiscordBotConfig, path: string): Promise<unknown> {
  return managerApiRequest(config, 'GET', path)
}

export async function managerApiPost(config: DiscordBotConfig, path: string, body?: unknown): Promise<unknown> {
  return managerApiRequest(config, 'POST', path, body)
}

/** `GET /api/servers` - best-effort: returns an empty list rather than throwing, since every
 *  caller (status embeds, autocomplete, admin commands) already has a sensible "no servers"
 *  fallback and shouldn't all need their own try/catch around this specific call. */
export async function fetchManagerServers(config: DiscordBotConfig): Promise<ManagerServerInfo[]> {
  try {
    const data = await managerApiGet(config, '/api/servers')
    return Array.isArray(data) ? (data as ManagerServerInfo[]) : []
  } catch (err) {
    log.warn(`Impossible de récupérer la liste des serveurs via l'API du Manager : ${(err as Error).message}`)
    return []
  }
}

/** Sends a raw RCON command to one server via the Manager's own `/api/servers/:id/rcon` -
 *  the same route the desktop Console tab's own command box uses, so `/rcon`, `/dinowipe`,
 *  `/saveworld` and `/adminchat` are all just different text commands through this one call. */
export async function sendManagerRconCommand(
  config: DiscordBotConfig,
  serverId: string,
  command: string
): Promise<{ ok: boolean; response?: string; error?: string }> {
  const data = await managerApiPost(config, `/api/servers/${encodeURIComponent(serverId)}/rcon`, { command })
  return data as { ok: boolean; response?: string; error?: string }
}
