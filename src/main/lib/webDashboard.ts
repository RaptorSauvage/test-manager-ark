import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import type { AppSettings, LogEvent, ServerProfile, ServerStatus, WebDashboardRole } from '@shared/types'
import { listProfiles, getSettings, saveSettings, listWebDashboardAccounts, listWebDashboardApiKeys } from '../store'
import { getStatus, getLogFilePath, watchLogFile, serverEvents } from './serverProcess'
import { sendRconCommand, parsePlayerListWithIds } from './rcon'
import { parseLogChunk, createLogEventCaches } from './logEvents'
import {
  doStartServer,
  doStopServerConfirmSave,
  doRestartServerConfirmSave,
  doUpdateServer,
  doStopUpdateRestart
} from './serverActions'
import { createBackup, listBackups, deleteBackup, restoreBackup, getBackupLog } from './backup'
import { getBackupScheduleStatus } from './schedule'
import { getGameVersion, getCachedGameVersion, setCachedGameVersion } from './serverVersion'
import { getOrCreateCert } from './tlsCert'
import {
  verifyPassword,
  createSession,
  getSession,
  destroySession,
  roleAtLeast,
  getSessionTokenFromRequest,
  buildSessionCookie,
  buildExpiredSessionCookie,
  isRateLimited,
  recordLoginFailure,
  recordLoginSuccess,
  getApiKeyFromRequest,
  parseApiKey
} from './auth'

let server: http.Server | https.Server | null = null
let lastError: string | null = null
let lastHost: string | null = null

/** How much of ShooterGame.log to re-read for backlog on a fresh page load/reconnect,
 *  and how many of the parsed events out of that backlog to actually keep - same defaults
 *  as the standalone Python dashboard this page replaces. */
const BACKLOG_BYTES = 300_000
const BACKLOG_MAX_LINES = 60

/** Event categories that can be individually hidden from the web dashboard's feed. */
const ALL_EVENT_LABELS = ['JOIN', 'LEFT', 'CHAT', 'WARN', 'KILL', 'TAME', 'CMD', 'SAVE', 'CRYO', 'MISSION', 'READY']

/**
 * Orders profiles the same way the Manager's own dashboard grid does, and drops hidden
 * ones: ungrouped profiles first (in their stored/reordered position), then each named
 * group's profiles (alphabetical by group name), also in their stored position within
 * the group. Hidden profiles never appear here, matching the desktop dashboard where
 * they're tucked away in a separate collapsed section.
 */
export function sortProfilesForDisplay(profiles: ServerProfile[]): ServerProfile[] {
  const visible = profiles.filter((p) => !p.hidden)
  const ungrouped = visible.filter((p) => !p.group.trim())
  const groupNames = Array.from(new Set(visible.filter((p) => p.group.trim()).map((p) => p.group.trim()))).sort()
  const grouped = groupNames.flatMap((groupName) => visible.filter((p) => p.group.trim() === groupName))
  return [...ungrouped, ...grouped]
}

function getDisabledLabels(): Set<string> {
  return new Set(getSettings().webDashboardDisabledLabels ?? [])
}

function setLabelEnabled(label: string, enabled: boolean): void {
  const settings = getSettings()
  const disabled = new Set(settings.webDashboardDisabledLabels ?? [])
  if (enabled) disabled.delete(label)
  else disabled.add(label)
  saveSettings({ ...settings, webDashboardDisabledLabels: Array.from(disabled) })
}

/**
 * Reads a server's live event feed straight from its own ShooterGame.log, independent of
 * whatever the Manager's own process tracking thinks its state is - same approach as the
 * standalone Python dashboard this page replaces (a fresh per-connection file tailer, not
 * tied to any "is this server running" bookkeeping), so the web dashboard keeps working
 * even for a server the Manager didn't itself start/adopt.
 */
function readLogBacklog(installDir: string): LogEvent[] {
  const logPath = getLogFilePath(installDir)
  if (!fs.existsSync(logPath)) return []

  const size = fs.statSync(logPath).size
  const readSize = Math.min(size, BACKLOG_BYTES)
  const buffer = Buffer.alloc(readSize)
  const fd = fs.openSync(logPath, 'r')
  try {
    fs.readSync(fd, buffer, 0, readSize, size - readSize)
  } finally {
    fs.closeSync(fd)
  }

  let text = buffer.toString('utf-8')
  if (readSize < size) {
    // Drop a possibly-truncated first line when starting mid-file.
    const firstNewline = text.indexOf('\n')
    if (firstNewline >= 0) text = text.slice(firstNewline + 1)
  }

  const disabled = getDisabledLabels()
  return parseLogChunk(text, createLogEventCaches())
    .filter((event) => !disabled.has(event.label))
    .slice(-BACKLOG_MAX_LINES)
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (err) {
        reject(err as Error)
      }
    })
    req.on('error', reject)
  })
}

function getClientIp(req: http.IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown'
}

/**
 * Gate for every route below `minRole`. When the web dashboard's login requirement is off
 * (the default, unchanged from before this feature existed), this always succeeds with a
 * synthetic full-access session - every route behaves exactly as it did previously. When
 * login is required, it accepts either an `Authorization: Bearer <key>` API key (for
 * scripts/bots that can't drive a login form) or the session cookie, sending the 401/403
 * itself and returning null on failure - callers must `return` immediately when this
 * returns null.
 */
async function requireRole(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  minRole: WebDashboardRole
): Promise<{ username: string; role: WebDashboardRole } | null> {
  if (!getSettings().webDashboardAuthEnabled) return { username: '', role: 'admin' }

  const presentedKey = getApiKeyFromRequest(req)
  if (presentedKey !== null) {
    const parsed = parseApiKey(presentedKey)
    const stored = parsed ? listWebDashboardApiKeys().find((k) => k.id === parsed.id) : undefined
    const valid = parsed && stored ? await verifyPassword(parsed.secret, stored.secretHash) : false
    if (!valid || !stored) {
      sendJson(res, 401, { error: 'Invalid API key' })
      return null
    }
    if (!roleAtLeast(stored.role, minRole)) {
      sendJson(res, 403, { error: 'Insufficient permissions' })
      return null
    }
    return { username: `api:${stored.label}`, role: stored.role }
  }

  const session = getSession(getSessionTokenFromRequest(req))
  if (!session) {
    sendJson(res, 401, { error: 'Not authenticated' })
    return null
  }
  if (!roleAtLeast(session.role, minRole)) {
    sendJson(res, 403, { error: 'Insufficient permissions' })
    return null
  }
  return session
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname

  if (req.method === 'GET' && path === '/') {
    const authEnabled = getSettings().webDashboardAuthEnabled
    const session = authEnabled ? getSession(getSessionTokenFromRequest(req)) : null
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(authEnabled && !session ? LOGIN_HTML : renderDashboardHtml(session?.role ?? null))
    return
  }

  if (req.method === 'POST' && path === '/api/login') {
    const ip = getClientIp(req)
    if (isRateLimited(ip)) {
      sendJson(res, 429, { ok: false, error: 'Too many failed attempts. Try again later.' })
      return
    }
    readJsonBody(req)
      .then(async (body) => {
        const username = typeof body.username === 'string' ? body.username.trim() : ''
        const password = typeof body.password === 'string' ? body.password : ''
        const account = listWebDashboardAccounts().find((a) => a.username.toLowerCase() === username.toLowerCase())
        const valid = account ? await verifyPassword(password, account.passwordHash) : false
        if (!account || !valid) {
          recordLoginFailure(ip)
          sendJson(res, 401, { ok: false, error: 'Invalid username or password' })
          return
        }
        recordLoginSuccess(ip)
        const token = createSession(account.username, account.role)
        res.setHeader('Set-Cookie', buildSessionCookie(token))
        sendJson(res, 200, { ok: true, role: account.role })
      })
      .catch(() => sendJson(res, 400, { ok: false, error: 'Invalid request body' }))
    return
  }

  if (req.method === 'POST' && path === '/api/logout') {
    destroySession(getSessionTokenFromRequest(req))
    res.setHeader('Set-Cookie', buildExpiredSessionCookie())
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.method === 'GET' && path === '/api/servers') {
    if (!(await requireRole(req, res, 'readonly'))) return
    const servers = await Promise.all(
      sortProfilesForDisplay(listProfiles()).map(async (profile) => {
        const status = getStatus(profile.id)
        let gameVersion = getCachedGameVersion(profile.id)
        if (!gameVersion) {
          gameVersion = await getGameVersion(profile.installDir)
          if (gameVersion) setCachedGameVersion(profile.id, gameVersion)
        }
        return {
          id: profile.id,
          name: profile.name,
          group: profile.group.trim(),
          state: status.state,
          players: status.players ?? [],
          cpu: status.cpu ?? null,
          memoryMB: status.memoryMB ?? null,
          gameVersion
        }
      })
    )
    sendJson(res, 200, servers)
    return
  }

  const eventsMatch = path.match(/^\/api\/servers\/([^/]+)\/events$/)
  if (req.method === 'GET' && eventsMatch) {
    if (!(await requireRole(req, res, 'readonly'))) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(eventsMatch[1]))
    sendJson(res, 200, profile ? readLogBacklog(profile.installDir) : [])
    return
  }

  const streamMatch = path.match(/^\/api\/servers\/([^/]+)\/events\/stream$/)
  if (req.method === 'GET' && streamMatch) {
    if (!(await requireRole(req, res, 'readonly'))) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(streamMatch[1]))
    if (!profile) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Unknown server')
      return
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    res.write('\n')
    // Captured into their own consts so the nested function declarations below (whose
    // closures TypeScript can't narrow the same way it narrows inline callbacks) don't
    // need to re-check profile for undefined on every use.
    const profileId = profile.id
    const installDir = profile.installDir

    let caches = createLogEventCaches()

    function onLogChunk(chunk: string, rotated: boolean): void {
      if (rotated) {
        // ARK opened a fresh log file (detected here by its inode changing) - drop
        // whatever the page was showing from the previous session and start resolving
        // player names fresh. Kept as a backup signal alongside the 'starting' status
        // hook below, for a server the Manager didn't itself (re)start.
        caches = createLogEventCaches()
        res.write('event: reset\ndata: {}\n\n')
      }
      const disabled = getDisabledLabels()
      for (const event of parseLogChunk(chunk, caches)) {
        if (disabled.has(event.label)) continue
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      }
    }

    let stopWatching = watchLogFile(installDir, onLogChunk)

    // The log file's own rotation isn't a reliable enough signal by itself - whether and
    // when ARK actually replaces the file on disk isn't consistently observable across
    // platforms. Spawning the process is something the Manager does itself, though, so
    // treat that as the definitive "a new session is starting" moment whenever it's the
    // Manager doing the (re)starting: drop the old tailer and start a fresh one so it
    // re-establishes its own read position from scratch instead of an offset that could
    // belong to a session that no longer exists.
    function onStatus(status: ServerStatus): void {
      if (status.profileId !== profileId || status.state !== 'starting') return
      caches = createLogEventCaches()
      res.write('event: reset\ndata: {}\n\n')
      stopWatching()
      stopWatching = watchLogFile(installDir, onLogChunk)
    }
    serverEvents.on('status', onStatus)

    req.on('close', () => {
      stopWatching()
      serverEvents.off('status', onStatus)
    })
    return
  }

  if (req.method === 'GET' && path === '/api/labelsettings') {
    if (!(await requireRole(req, res, 'readonly'))) return
    const disabled = getDisabledLabels()
    const result: Record<string, boolean> = {}
    for (const label of ALL_EVENT_LABELS) result[label] = !disabled.has(label)
    sendJson(res, 200, result)
    return
  }

  const labelMatch = path.match(/^\/api\/labelsettings\/([^/]+)$/)
  if (req.method === 'POST' && labelMatch) {
    if (!(await requireRole(req, res, 'admin'))) return
    const label = decodeURIComponent(labelMatch[1])
    if (!ALL_EVENT_LABELS.includes(label)) {
      sendJson(res, 404, { error: 'Unknown event label' })
      return
    }
    readJsonBody(req)
      .then((body) => {
        const enabled = typeof body.enabled !== 'boolean' || body.enabled
        setLabelEnabled(label, enabled)
        sendJson(res, 200, { label, enabled })
      })
      .catch(() => sendJson(res, 400, { error: 'Invalid request body' }))
    return
  }

  const playersMatch = path.match(/^\/api\/servers\/([^/]+)\/players$/)
  if (req.method === 'GET' && playersMatch) {
    if (!(await requireRole(req, res, 'readonly'))) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(playersMatch[1]))
    if (!profile) {
      sendJson(res, 200, [])
      return
    }
    sendRconCommand(profile, 'ListPlayers').then((result) => {
      sendJson(res, 200, result.ok && result.response ? parsePlayerListWithIds(result.response) : [])
    })
    return
  }

  const startMatch = path.match(/^\/api\/servers\/([^/]+)\/start$/)
  if (req.method === 'POST' && startMatch) {
    if (!(await requireRole(req, res, 'operator'))) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(startMatch[1]))
    if (!profile) {
      sendJson(res, 404, { ok: false, error: 'Unknown server' })
      return
    }
    try {
      doStartServer(profile)
      sendJson(res, 200, { ok: true })
    } catch (err) {
      sendJson(res, 400, { ok: false, error: (err as Error).message })
    }
    return
  }

  // Stop/restart/stop+update+restart can take a while (RCON SaveWorld+DoExit, a
  // multi-minute SteamCMD download) - respond once SaveWorld's outcome is confirmed
  // rather than holding the request open for the whole thing, same as the desktop app's
  // own buttons: the periodic /api/servers poll picks up the state changes (stopping/
  // updating/starting/running) as they happen. A failure past this point is logged
  // server-side since there's no request left to answer by then. Responding only once
  // SaveWorld is confirmed (rather than the instant the action is merely kicked off)
  // means `saved` in the response is meaningful - a caller polling too fast right after
  // a bare "ok" can't mistake "we started stopping it" for "it actually saved first".
  const stopMatch = path.match(/^\/api\/servers\/([^/]+)\/stop$/)
  if (req.method === 'POST' && stopMatch) {
    if (!(await requireRole(req, res, 'operator'))) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(stopMatch[1]))
    if (!profile) {
      sendJson(res, 404, { ok: false, error: 'Unknown server' })
      return
    }
    const { saved } = await doStopServerConfirmSave(profile)
    sendJson(res, 200, { ok: true, saved })
    return
  }

  const restartMatch = path.match(/^\/api\/servers\/([^/]+)\/restart$/)
  if (req.method === 'POST' && restartMatch) {
    if (!(await requireRole(req, res, 'operator'))) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(restartMatch[1]))
    if (!profile) {
      sendJson(res, 404, { ok: false, error: 'Unknown server' })
      return
    }
    const { saved } = await doRestartServerConfirmSave(profile)
    sendJson(res, 200, { ok: true, saved })
    return
  }

  const updateMatch = path.match(/^\/api\/servers\/([^/]+)\/update$/)
  if (req.method === 'POST' && updateMatch) {
    if (!(await requireRole(req, res, 'operator'))) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(updateMatch[1]))
    if (!profile) {
      sendJson(res, 404, { ok: false, error: 'Unknown server' })
      return
    }
    doUpdateServer(profile).catch((err: Error) => console.error(`Web dashboard update failed for ${profile.name}:`, err.message))
    sendJson(res, 200, { ok: true })
    return
  }

  const stopUpdateRestartMatch = path.match(/^\/api\/servers\/([^/]+)\/stop-update-restart$/)
  if (req.method === 'POST' && stopUpdateRestartMatch) {
    if (!(await requireRole(req, res, 'operator'))) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(stopUpdateRestartMatch[1]))
    if (!profile) {
      sendJson(res, 404, { ok: false, error: 'Unknown server' })
      return
    }
    doStopUpdateRestart(profile).catch((err: Error) =>
      console.error(`Web dashboard stop+update+restart failed for ${profile.name}:`, err.message)
    )
    sendJson(res, 200, { ok: true })
    return
  }

  const rconMatch = path.match(/^\/api\/servers\/([^/]+)\/rcon$/)
  if (req.method === 'POST' && rconMatch) {
    if (!(await requireRole(req, res, 'operator'))) return
    const profileId = decodeURIComponent(rconMatch[1])
    const profile = listProfiles().find((p) => p.id === profileId)
    if (!profile) {
      sendJson(res, 404, { ok: false, error: 'Unknown server' })
      return
    }
    readJsonBody(req)
      .then(async (body) => {
        const command = typeof body.command === 'string' ? body.command.trim() : ''
        if (!command) {
          sendJson(res, 400, { ok: false, error: 'Empty command' })
          return
        }
        const result = await sendRconCommand(profile, command)
        sendJson(res, 200, result)
      })
      .catch(() => sendJson(res, 400, { ok: false, error: 'Invalid request body' }))
    return
  }

  const backupStatusMatch = path.match(/^\/api\/servers\/([^/]+)\/backups\/status$/)
  if (req.method === 'GET' && backupStatusMatch) {
    if (!(await requireRole(req, res, 'readonly'))) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(backupStatusMatch[1]))
    if (!profile) {
      sendJson(res, 404, { error: 'Unknown server' })
      return
    }
    const schedule = getBackupScheduleStatus(profile)
    sendJson(res, 200, {
      backupDir: profile.backupDir,
      maxBackups: profile.maxBackups,
      scheduleEnabled: profile.backupScheduleEnabled,
      scheduleCron: profile.backupSchedule ?? '',
      scheduleActive: schedule.active,
      nextRunAt: schedule.nextRunAt
    })
    return
  }

  const backupLogMatch = path.match(/^\/api\/servers\/([^/]+)\/backups\/log$/)
  if (req.method === 'GET' && backupLogMatch) {
    if (!(await requireRole(req, res, 'readonly'))) return
    sendJson(res, 200, getBackupLog(decodeURIComponent(backupLogMatch[1])))
    return
  }

  const backupRestoreMatch = path.match(/^\/api\/servers\/([^/]+)\/backups\/restore$/)
  if (req.method === 'POST' && backupRestoreMatch) {
    if (!(await requireRole(req, res, 'admin'))) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(backupRestoreMatch[1]))
    if (!profile) {
      sendJson(res, 404, { ok: false, error: 'Unknown server' })
      return
    }
    readJsonBody(req)
      .then((body) => {
        const filePath = typeof body.filePath === 'string' ? body.filePath : ''
        if (!filePath) {
          sendJson(res, 400, { ok: false, error: 'Missing filePath' })
          return
        }
        restoreBackup(profile, filePath)
        sendJson(res, 200, { ok: true })
      })
      .catch((err: Error) => sendJson(res, 400, { ok: false, error: err.message }))
    return
  }

  const backupDeleteMatch = path.match(/^\/api\/servers\/([^/]+)\/backups\/delete$/)
  if (req.method === 'POST' && backupDeleteMatch) {
    if (!(await requireRole(req, res, 'admin'))) return
    readJsonBody(req)
      .then((body) => {
        const filePath = typeof body.filePath === 'string' ? body.filePath : ''
        if (!filePath) {
          sendJson(res, 400, { ok: false, error: 'Missing filePath' })
          return
        }
        deleteBackup(filePath)
        sendJson(res, 200, { ok: true })
      })
      .catch((err: Error) => sendJson(res, 400, { ok: false, error: err.message }))
    return
  }

  const backupsMatch = path.match(/^\/api\/servers\/([^/]+)\/backups$/)
  if (req.method === 'GET' && backupsMatch) {
    if (!(await requireRole(req, res, 'readonly'))) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(backupsMatch[1]))
    sendJson(res, 200, profile ? listBackups(profile) : [])
    return
  }
  if (req.method === 'POST' && backupsMatch) {
    if (!(await requireRole(req, res, 'operator'))) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(backupsMatch[1]))
    if (!profile) {
      sendJson(res, 404, { ok: false, error: 'Unknown server' })
      return
    }
    try {
      const entry = await createBackup(profile)
      sendJson(res, 200, { ok: true, entry })
    } catch (err) {
      sendJson(res, 400, { ok: false, error: (err as Error).message })
    }
    return
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('Not found')
}

export function stopWebDashboard(): void {
  if (server) {
    server.close()
    server = null
  }
}

/** Starts the web dashboard bound to `host` - '127.0.0.1' (default) keeps it reachable
 *  from this machine only; '0.0.0.0' or a specific local IP makes it reachable from other
 *  devices on the LAN. By default this page has no authentication of its own (same posture
 *  as the standalone Python dashboard it replaces), so widening the host is a deliberate
 *  choice made in Settings, never a default - unless "Require login" is also turned on, in
 *  which case every route is gated behind a session and the server switches to HTTPS with
 *  a self-signed certificate, since login credentials shouldn't travel in the clear. */
export function startWebDashboard(port: number, host: string): void {
  stopWebDashboard()
  lastError = null
  lastHost = host
  const authEnabled = getSettings().webDashboardAuthEnabled
  if (authEnabled && listWebDashboardAccounts().length === 0) {
    lastError = 'Add at least one account in Settings before enabling login.'
    return
  }
  if (authEnabled) {
    const { key, cert } = getOrCreateCert()
    server = https.createServer({ key, cert }, handleRequest)
  } else {
    server = http.createServer(handleRequest)
  }
  server.on('error', (err) => {
    lastError = (err as Error).message
    server = null
  })
  server.listen(port, host)
}

export function applyWebDashboardSettings(settings: AppSettings): void {
  if (settings.webDashboardEnabled) startWebDashboard(settings.webDashboardPort, settings.webDashboardHost || '127.0.0.1')
  else stopWebDashboard()
}

export function getWebDashboardStatus(): { running: boolean; error: string | null; host: string | null } {
  return { running: server !== null, error: lastError, host: server ? lastHost : null }
}

/** Non-internal IPv4 addresses of this machine, so Settings can suggest what to type into
 *  the Host field for LAN access instead of the user having to look it up themselves. */
export function getLocalNetworkIps(): string[] {
  const ips: string[] = []
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const addr of addresses ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address)
    }
  }
  return ips
}

/** Splices the caller's role into the dashboard page as `window.__role`, so the client JS
 *  can hide controls it isn't allowed to use (the real boundary is the server-side route
 *  guards above - this is UX only). `role` is null when login isn't required at all, in
 *  which case nothing is injected and the page behaves exactly as it did before this
 *  feature existed - `window.__role` stays undefined. */
function renderDashboardHtml(role: WebDashboardRole | null): string {
  if (!role) return DASHBOARD_HTML
  return DASHBOARD_HTML.replace('<script>', `<script>window.__role = ${JSON.stringify(role)};</script>\n<script>`)
}

const LOGIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ARK Server Manager - Login</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #14161a; --panel: #1d2027; --border: #2c303a; --text: #e6e8ec; --muted: #9aa0ab;
    --accent: #4f8cff; --danger: #e0555b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    height: 100vh; display: flex; align-items: center; justify-content: center;
  }
  form { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 28px; width: 280px; display: flex; flex-direction: column; gap: 12px; }
  h1 { font-size: 1.05rem; margin: 0 0 4px; }
  input, button { background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 9px 10px; font-size: 0.95rem; }
  button { cursor: pointer; background: var(--accent); border-color: var(--accent); color: #fff; }
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  #login-error { color: var(--danger); font-size: 0.85rem; min-height: 1.1em; }
</style>
</head>
<body>
<form id="login-form">
  <h1>ARK Server Manager</h1>
  <input id="login-username" placeholder="Username" autocomplete="username" autofocus />
  <input id="login-password" type="password" placeholder="Password" autocomplete="current-password" />
  <div id="login-error"></div>
  <button type="submit">Log in</button>
</form>
<script>
(function () {
  var form = document.getElementById('login-form');
  var usernameEl = document.getElementById('login-username');
  var passwordEl = document.getElementById('login-password');
  var errorEl = document.getElementById('login-error');
  var submitBtn = form.querySelector('button');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorEl.textContent = '';
    submitBtn.disabled = true;
    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameEl.value, password: passwordEl.value })
    })
      .then(function (r) { return r.json(); })
      .then(function (result) {
        if (result.ok) {
          location.reload();
          return;
        }
        errorEl.textContent = result.error || 'Login failed';
        submitBtn.disabled = false;
      })
      .catch(function () {
        errorEl.textContent = 'Request failed';
        submitBtn.disabled = false;
      });
  });
})();
</script>
</body>
</html>
`

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ARK Server Manager - Web Console</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #14161a; --panel: #1d2027; --border: #2c303a; --text: #e6e8ec; --muted: #9aa0ab;
    --accent: #4f8cff; --danger: #e0555b; --ok: #3fbf6f; --warn: #e0a63f;
    --status-running: #1f8a4c; --status-starting: #7ee6a0; --status-updating: #6fa8ff;
    --status-stopping: #f2878b; --status-stopped: #a83239; --status-restarting: #e0a63f;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    display: flex; height: 100vh; overflow: hidden;
  }
  #sidebar { width: 190px; flex-shrink: 0; border-right: 1px solid var(--border); display: flex; flex-direction: column; padding: 16px 10px; gap: 4px; overflow-y: auto; }
  #sidebar h1 { font-size: 0.95rem; margin: 0 6px 12px; }
  .nav-btn { text-align: left; background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 9px 10px; font-size: 0.88rem; }
  .nav-btn:hover { border-color: var(--border); }
  .nav-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .nav-btn.active:hover { border-color: var(--accent); }
  .nav-sep { width: 100%; border: none; border-top: 1px solid var(--border); margin: 6px 0; }
  .nav-logout { margin-top: auto; color: var(--muted); }
  #main-area { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .view { display: none; flex: 1; min-height: 0; }
  .view.active { display: flex; flex-direction: column; }
  #view-cluster.active { display: block; overflow-y: auto; padding: 16px; }
  #cluster-cards { display: flex; flex-direction: column; gap: 24px; }
  .cluster-group summary { cursor: pointer; color: var(--muted); font-weight: 600; margin-bottom: 12px; }
  .cluster-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 18px; }
  .cluster-card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 18px; cursor: pointer; }
  .cluster-card:hover { border-color: var(--accent); }
  .cluster-card-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
  .cluster-card-header h3 { margin: 0; font-size: 1.05rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cluster-card-state { flex-shrink: 0; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; padding: 3px 9px; border-radius: 999px; border: 1px solid currentColor; }
  .cluster-card-state.state-running { color: var(--status-running); }
  .cluster-card-state.state-starting { color: var(--status-starting); }
  .cluster-card-state.state-updating { color: var(--status-updating); }
  .cluster-card-state.state-stopping { color: var(--status-stopping); }
  .cluster-card-state.state-stopped { color: var(--status-stopped); }
  .cluster-card-state.state-restarting { color: var(--status-restarting); }
  .cluster-card-state.state-error { color: var(--danger); }
  .cluster-card-stats { display: flex; flex-direction: column; gap: 6px; font-size: 0.92rem; color: var(--muted); }
  .cluster-card-stats strong { color: var(--text); font-weight: 600; }
  header { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  header h1 { font-size: 1rem; margin: 0; }
  select, input, button { background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 0.9rem; }
  button { cursor: pointer; }
  button:hover { border-color: var(--accent); }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  button:disabled:hover { border-color: var(--border); }
  #server-actions { display: flex; gap: 6px; }
  #server-actions button.ok { border-color: var(--ok); color: var(--ok); }
  #server-actions button.ok:hover:not(:disabled) { background: var(--ok); color: #14161a; }
  #server-actions button.danger { border-color: var(--danger); color: var(--danger); }
  #server-actions button.danger:hover:not(:disabled) { background: var(--danger); color: #14161a; }
  #server-actions button.info { border-color: var(--accent); color: var(--accent); }
  #server-actions button.info:hover:not(:disabled) { background: var(--accent); color: #14161a; }
  #server-actions button.warn { border-color: var(--warn); color: var(--warn); }
  #server-actions button.warn:hover:not(:disabled) { background: var(--warn); color: #14161a; }
  main { flex: 1; display: flex; flex-direction: column; padding: 12px 16px; min-height: 0; }
  .panel { flex: 1; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; min-height: 0; }
  #console { flex: 1; overflow-y: auto; font-size: 0.82rem; font-family: Consolas, Menlo, monospace; min-height: 200px; }
  /* Deliberately not a flex row: letting ts/label/text flow as regular inline content
     means a wrapped line breaks back to the panel's own left edge, not indented under
     wherever the text happened to start - much more readable on a narrow phone screen. */
  .log-event { padding: 3px 0; line-height: 1.4; }
  .log-event .ts { color: var(--muted); margin-right: 8px; }
  .log-event .label { font-weight: 700; margin-right: 8px; }
  .log-event .text { white-space: pre-wrap; word-break: break-word; }
  .log-event-join .label, .log-event-ready .label { color: #1f8a4c; }
  .log-event-leave .label { color: #a83239; }
  .log-event-save .label { color: var(--muted); }
  .log-event-cmd .label, .log-event-freeze .label { color: var(--accent); }
  .log-event-warn .label, .log-event-mission .label { color: var(--warn); }
  .log-event-kill .label { color: var(--danger); }
  .log-event-tame .label { color: var(--ok); }
  .log-event-rcon-cmd .label { color: var(--accent); }
  .log-event-rcon-error .label { color: var(--danger); }
  .log-event-join .player { color: #1f8a4c; }
  .log-event-leave .player { color: #a83239; }
  #rcon-form { display: flex; gap: 8px; margin-top: 8px; }
  #rcon-form input, #rcon-form button { padding: 10px 14px; font-size: 1rem; border-radius: 8px; }
  #rcon-input { flex: 1; }
  .empty-state { color: var(--muted); font-size: 0.85rem; }
  #filters-bar { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
  #btn-toggle-filters { font-size: 0.8rem; padding: 4px 8px; flex-shrink: 0; }
  #filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; font-size: 0.8rem; color: var(--muted); }
  #filters-bar.collapsed #filters { display: none; }
  #filters label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
  #filters input { padding: 0; width: auto; }
  .content-row { flex: 1; display: flex; gap: 12px; min-height: 0; }
  .console-panel { flex: 3; }
  .side-col { display: flex; flex-direction: column; gap: 12px; flex: 1; min-width: 220px; max-width: 300px; }
  .side-col.collapsed { display: none; }
  #btn-toggle-sidecol { font-size: 0.8rem; padding: 4px 8px; flex-shrink: 0; }
  .status-panel { flex: 0 0 auto; }
  .status-panel h3 { margin: 0 0 10px; font-size: 0.95rem; }
  .status-lines { display: flex; flex-direction: column; gap: 6px; font-size: 0.85rem; color: var(--muted); }
  .status-lines strong { color: var(--text); font-weight: 600; }
  .players-panel { flex: 1; min-height: 0; }
  .players-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .players-header h3 { margin: 0; font-size: 0.95rem; }
  .players-count { background: var(--accent); color: #fff; border-radius: 999px; padding: 1px 9px; font-size: 0.75rem; }
  #players-list { flex: 1; overflow-y: auto; font-size: 0.85rem; }
  .player-row { padding: 6px 8px; border-radius: 6px; }
  .player-row:hover { background: var(--bg); }
  .context-menu { position: fixed; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 4px; z-index: 1000; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5); min-width: 150px; }
  .context-menu button { display: block; width: 100%; text-align: left; border: none; background: none; padding: 7px 10px; border-radius: 4px; font-size: 0.85rem; }
  .context-menu button:hover { background: var(--bg); }
  .context-menu button.danger { color: var(--danger); }
  #backup-content { display: none; flex: 1; flex-direction: column; min-height: 0; }
  #backup-content.active { display: flex; }
  .form-actions { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  #backup-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  #backup-table th, #backup-table td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--border); }
  #backup-table th { color: var(--muted); font-weight: 600; }
  #backup-table .backup-row-actions { display: flex; gap: 6px; justify-content: flex-end; }
  #backup-table .backup-row-actions button { font-size: 0.78rem; padding: 4px 8px; }
  #btn-backup-show-more { display: none; width: 100%; margin-top: 10px; font-size: 0.8rem; }
  .backup-table-panel { flex: 0 1 60%; }
  .backup-log-panel { flex: 0 1 40%; min-width: 220px; }
  #backup-log { flex: 1; overflow-y: auto; font-size: 0.85rem; }
  .backup-log-line { padding: 3px 0; color: var(--muted); }
  .backup-log-line.error { color: var(--danger); }
  .backup-log-time { color: var(--muted); margin-right: 6px; }
  .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 8px 14px; font-size: 0.85rem; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5); z-index: 1100; }
  @media (max-width: 700px) {
    /* The desktop layout is a fixed-viewport "app" (body: height:100vh + overflow:hidden)
       that relies on each panel being its own bounded, individually-scrolling box. That
       shape keeps breaking on mobile - a panel not explicitly height-capped just grows
       past the screen, and because the page itself can't scroll, that overflow becomes
       completely unreachable rather than merely ugly. Simpler and more robust: let the
       page scroll normally on mobile, like any other web page, and only keep an internal
       scroll box where one is actually wanted (the live console feed, the online players
       list) - everything else just flows and the page grows to fit it. */
    body { flex-direction: column; height: auto; min-height: 100vh; overflow: visible; }
    #sidebar { width: auto; flex-direction: row; border-right: none; border-bottom: 1px solid var(--border); padding: 8px 10px; overflow-x: auto; }
    #sidebar h1 { display: none; }
    .nav-btn { flex-shrink: 0; }
    .nav-logout { margin-top: 0; margin-left: auto; }
    #main-area { overflow: visible; }
    .view.active { overflow: visible; }
    header { padding: 10px 12px; gap: 8px; }
    main { padding: 8px 10px; overflow: visible; }
    select, #server-actions button { flex: 1 1 auto; }
    .content-row { flex-direction: column; }
    /* flex:1 turned out not to reliably bound this on real mobile browsers - a chain of
       nested flex-grow containers several levels deep (main-area > view > main >
       content-row > console-panel) apparently doesn't force #console's overflow-y:auto to
       actually kick in the way it does on desktop (verified: with a busy 60-event backlog,
       the panel just grew to fit every line instead of scrolling internally). A real vh-
       based height is a definite value regardless of how that chain resolves, so it
       reliably stays a compact box - and scales with the actual device screen instead of
       being a flat number that's too small on a tall phone. */
    .console-panel { flex: none; height: 55vh; min-height: 280px; }
    #console { font-size: 0.72rem; }
    .log-event { padding: 2px 0; line-height: 1.3; }
    .side-col { flex: none; width: 100%; max-width: none; }
    .players-panel { flex: none; max-height: 160px; }
    #players-list { display: flex; flex-direction: row; flex-wrap: wrap; overflow-y: hidden; gap: 6px; }
    .player-row { flex: 0 0 auto; background: var(--bg); border: 1px solid var(--border); }
    .cluster-cards { grid-template-columns: 1fr; gap: 10px; }
    .cluster-card { padding: 14px; }
    .form-actions { flex-wrap: wrap; }
    .form-actions button { flex: 1 1 auto; }
    .backup-table-panel, .backup-log-panel { flex: none; width: 100%; min-width: 0; }
    .backup-table-panel { overflow-x: auto; }
    #backup-table { font-size: 0.78rem; }
  }
</style>
</head>
<body>
<nav id="sidebar">
  <h1>ARK Manager</h1>
  <button id="nav-cluster" class="nav-btn" type="button">Cluster Dashboard</button>
  <hr class="nav-sep" />
  <button id="nav-console" class="nav-btn" type="button">Dashboard</button>
  <button id="nav-backup" class="nav-btn" type="button">Backup</button>
</nav>
<div id="main-area">
  <section id="view-cluster" class="view">
    <div id="cluster-cards"></div>
  </section>
  <section id="view-console" class="view">
    <header>
      <h1>ARK Server Manager</h1>
      <select id="server-select"></select>
      <div id="server-actions">
        <button id="btn-start" class="ok">Start</button>
        <button id="btn-stop" class="danger">Stop</button>
        <button id="btn-restart" class="warn">Restart</button>
        <button id="btn-stop-update-restart" class="info">Update Restart</button>
      </div>
      <button id="btn-toggle-filters" type="button">Events ▾</button>
      <button id="btn-toggle-sidecol" type="button">Status ▾</button>
    </header>
    <main>
      <div id="filters-bar">
        <div id="filters"></div>
      </div>
      <div class="content-row">
        <section class="panel console-panel">
          <div id="console"></div>
          <form id="rcon-form">
            <input id="rcon-input" placeholder="e.g. Broadcast Hello world" autocomplete="off" />
            <button type="submit">Send</button>
          </form>
        </section>
        <div id="side-col" class="side-col">
          <aside class="panel status-panel">
            <h3>Status</h3>
            <div id="status"></div>
          </aside>
          <aside class="panel players-panel">
            <div class="players-header">
              <h3>Online players</h3>
              <span class="players-count" id="players-count">0</span>
            </div>
            <div id="players-list"></div>
          </aside>
        </div>
      </div>
    </main>
  </section>
  <section id="view-backup" class="view">
    <header>
      <h1>Backup</h1>
      <span id="backup-server-name"></span>
    </header>
    <main>
      <p id="backup-no-server" class="empty-state">Select a server in the Dashboard view first.</p>
      <div id="backup-content">
        <p id="backup-info" class="empty-state"></p>
        <div class="form-actions">
          <button id="btn-backup-create">Create backup now</button>
          <button id="btn-backup-refresh" type="button">Refresh</button>
        </div>
        <div class="content-row">
          <section class="panel backup-table-panel">
            <table id="backup-table">
              <thead>
                <tr><th>File Name</th><th>Size</th><th>Creation Time</th><th></th></tr>
              </thead>
              <tbody id="backup-table-body"></tbody>
            </table>
            <button id="btn-backup-show-more" type="button"></button>
          </section>
          <aside class="panel backup-log-panel">
            <h3>Backup Process Log</h3>
            <div id="backup-log"></div>
          </aside>
        </div>
      </div>
    </main>
  </section>
</div>
<script>
(function () {
  // Set by the server (see renderDashboardHtml in webDashboard.ts) only when "Require
  // login" is on; stays undefined otherwise, in which case every role check below is a
  // no-op and the page behaves exactly as it did before this feature existed. The real
  // enforcement is server-side (every route checks this same role) - hiding controls here
  // is just so a role never sees a button that would 401/403 if clicked.
  var role = typeof window.__role !== 'undefined' ? window.__role : null;
  var canOperate = role === 'operator' || role === 'admin';
  var canAdmin = role === 'admin';

  var currentId = null;
  var es = null;
  var consoleEl = document.getElementById('console');
  var select = document.getElementById('server-select');
  var statusEl = document.getElementById('status');
  var rconForm = document.getElementById('rcon-form');
  var rconInput = document.getElementById('rcon-input');
  var filtersEl = document.getElementById('filters');
  var filtersBarEl = document.getElementById('filters-bar');
  var toggleFiltersBtn = document.getElementById('btn-toggle-filters');
  var playersListEl = document.getElementById('players-list');
  var playersCountEl = document.getElementById('players-count');
  var startBtn = document.getElementById('btn-start');
  var stopBtn = document.getElementById('btn-stop');
  var restartBtn = document.getElementById('btn-restart');
  var stopUpdateRestartBtn = document.getElementById('btn-stop-update-restart');
  var contextMenuEl = null;

  function closeContextMenu() {
    if (contextMenuEl) { contextMenuEl.remove(); contextMenuEl = null; }
  }
  document.addEventListener('click', closeContextMenu);
  document.addEventListener('scroll', closeContextMenu, true);

  function showToast(message) {
    var toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 2200);
  }

  // navigator.clipboard is only available in a "secure context" - https, or the
  // literal hostnames localhost/127.0.0.1. Reaching this page via a LAN IP (Settings'
  // Host field set to something other than 127.0.0.1) is plain http from a non-localhost
  // hostname, so the Clipboard API is simply absent there - fall back to the older
  // execCommand('copy') approach via a temporary textarea, which still works.
  function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      var ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (err) {
        // fall through - ok stays false, handled below
      }
      textarea.remove();
      if (ok) resolve(); else reject(new Error('Copy command was not available'));
    });
  }

  function showContextMenu(x, y, player) {
    closeContextMenu();
    var menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    var copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy ID';
    copyBtn.addEventListener('click', function () {
      copyToClipboard(player.id)
        .then(function () { showToast('Copied ' + player.name + ' ID to clipboard'); })
        .catch(function () { showToast('Could not copy automatically - ID: ' + player.id); });
    });
    menu.appendChild(copyBtn);

    if (!role || canOperate) {
      var kickBtn = document.createElement('button');
      kickBtn.className = 'danger';
      kickBtn.textContent = 'Kick';
      kickBtn.addEventListener('click', function () {
        if (!currentId) return;
        if (!confirm('Kick ' + player.name + '?')) return;
        fetch('/api/servers/' + encodeURIComponent(currentId) + '/rcon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'KickPlayer ' + player.id })
        });
      });
      menu.appendChild(kickBtn);
    }

    document.body.appendChild(menu);
    contextMenuEl = menu;
  }

  function loadPlayers() {
    if (!currentId) {
      playersListEl.innerHTML = '';
      playersCountEl.textContent = '0';
      return;
    }
    fetch('/api/servers/' + encodeURIComponent(currentId) + '/players')
      .then(function (r) { return r.json(); })
      .then(function (players) {
        playersCountEl.textContent = String(players.length);
        playersListEl.innerHTML = '';
        if (players.length === 0) {
          var empty = document.createElement('p');
          empty.className = 'empty-state';
          empty.textContent = 'No players connected';
          playersListEl.appendChild(empty);
          return;
        }
        players.forEach(function (p) {
          var row = document.createElement('div');
          row.className = 'player-row';
          row.textContent = p.name;
          row.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            e.stopPropagation();
            showContextMenu(e.clientX, e.clientY, p);
          });
          playersListEl.appendChild(row);
        });
      });
  }

  var FILTERS_COLLAPSED_KEY = 'ark-dashboard-filters-collapsed';
  var filtersCollapsed = false;
  try { filtersCollapsed = localStorage.getItem(FILTERS_COLLAPSED_KEY) === '1'; } catch (err) { /* storage unavailable - not fatal */ }

  function applyFiltersCollapsed() {
    filtersBarEl.classList.toggle('collapsed', filtersCollapsed);
    toggleFiltersBtn.textContent = filtersCollapsed ? 'Events ▸' : 'Events ▾';
  }
  applyFiltersCollapsed();

  toggleFiltersBtn.addEventListener('click', function () {
    filtersCollapsed = !filtersCollapsed;
    try { localStorage.setItem(FILTERS_COLLAPSED_KEY, filtersCollapsed ? '1' : '0'); } catch (err) { /* storage unavailable - not fatal */ }
    applyFiltersCollapsed();
  });

  // Lets the Status + Online players column be hidden to give the console more room -
  // handy on a small screen where it otherwise pushes the console up. The toggle itself
  // lives in the header rather than inside the column, so it stays reachable once collapsed.
  var toggleSideColBtn = document.getElementById('btn-toggle-sidecol');
  var sideColEl = document.getElementById('side-col');
  var SIDE_COL_COLLAPSED_KEY = 'ark-dashboard-sidecol-collapsed';
  var sideColCollapsed = false;
  try { sideColCollapsed = localStorage.getItem(SIDE_COL_COLLAPSED_KEY) === '1'; } catch (err) { /* storage unavailable - not fatal */ }

  function applySideColCollapsed() {
    sideColEl.classList.toggle('collapsed', sideColCollapsed);
    toggleSideColBtn.textContent = sideColCollapsed ? 'Status ▸' : 'Status ▾';
  }
  applySideColCollapsed();

  toggleSideColBtn.addEventListener('click', function () {
    sideColCollapsed = !sideColCollapsed;
    try { localStorage.setItem(SIDE_COL_COLLAPSED_KEY, sideColCollapsed ? '1' : '0'); } catch (err) { /* storage unavailable - not fatal */ }
    applySideColCollapsed();
  });

  var navClusterBtn = document.getElementById('nav-cluster');
  var navConsoleBtn = document.getElementById('nav-console');
  var navBackupBtn = document.getElementById('nav-backup');
  var viewClusterEl = document.getElementById('view-cluster');
  var viewConsoleEl = document.getElementById('view-console');
  var viewBackupEl = document.getElementById('view-backup');
  var clusterCardsEl = document.getElementById('cluster-cards');

  if (role === 'readonly') navBackupBtn.style.display = 'none';
  if (role && !canOperate) {
    startBtn.style.display = 'none';
    stopBtn.style.display = 'none';
    restartBtn.style.display = 'none';
    stopUpdateRestartBtn.style.display = 'none';
    rconForm.style.display = 'none';
  }
  if (role) {
    var sidebarEl = document.getElementById('sidebar');
    var logoutBtn = document.createElement('button');
    logoutBtn.className = 'nav-btn nav-logout';
    logoutBtn.type = 'button';
    logoutBtn.textContent = 'Log out (' + role + ')';
    logoutBtn.addEventListener('click', function () {
      fetch('/api/logout', { method: 'POST' }).then(function () { location.reload(); });
    });
    sidebarEl.appendChild(logoutBtn);
  }

  var ACTIVE_VIEW_KEY = 'ark-dashboard-active-view';
  var activeView = 'console';
  try { activeView = localStorage.getItem(ACTIVE_VIEW_KEY) || 'console'; } catch (err) { /* storage unavailable - not fatal */ }

  function applyActiveView() {
    navClusterBtn.classList.toggle('active', activeView === 'cluster');
    navConsoleBtn.classList.toggle('active', activeView === 'console');
    navBackupBtn.classList.toggle('active', activeView === 'backup');
    viewClusterEl.classList.toggle('active', activeView === 'cluster');
    viewConsoleEl.classList.toggle('active', activeView === 'console');
    viewBackupEl.classList.toggle('active', activeView === 'backup');
    if (activeView === 'backup') loadBackupView();
  }

  function selectView(view) {
    activeView = view;
    try { localStorage.setItem(ACTIVE_VIEW_KEY, view); } catch (err) { /* storage unavailable - not fatal */ }
    applyActiveView();
  }
  navClusterBtn.addEventListener('click', function () { selectView('cluster'); });
  navConsoleBtn.addEventListener('click', function () { selectView('console'); });
  navBackupBtn.addEventListener('click', function () { selectView('backup'); });

  // Renders every server as a read-only monitoring card (state/players/CPU/RAM) - like
  // the desktop app's own dashboard cards, minus the Start/Stop/Restart buttons, since
  // this view is meant for at-a-glance monitoring rather than control. Built from the
  // same /api/servers response loadServers() already fetches every poll, no separate
  // request needed.
  function buildClusterCard(s) {
    var card = document.createElement('div');
    card.className = 'cluster-card';

    var header = document.createElement('div');
    header.className = 'cluster-card-header';
    var name = document.createElement('h3');
    name.textContent = s.name;
    var state = document.createElement('span');
    state.className = 'cluster-card-state state-' + s.state;
    state.textContent = s.state;
    header.appendChild(name);
    header.appendChild(state);

    var stats = document.createElement('div');
    stats.className = 'cluster-card-stats';
    var playerCount = s.players ? s.players.length : 0;
    var lines = [
      ['Version', s.gameVersion || '-'],
      ['Players', String(playerCount) + (playerCount ? ': ' + s.players.join(', ') : '')],
      ['CPU', s.cpu != null ? s.cpu + '%' : '-'],
      ['RAM', s.memoryMB != null ? s.memoryMB + ' MB' : '-']
    ];
    lines.forEach(function (pair) {
      var line = document.createElement('div');
      var strong = document.createElement('strong');
      strong.textContent = pair[0] + ': ';
      line.appendChild(strong);
      line.appendChild(document.createTextNode(pair[1]));
      stats.appendChild(line);
    });

    card.appendChild(header);
    card.appendChild(stats);
    card.addEventListener('click', function () {
      select.value = s.id;
      selectServer(s.id);
      selectView('console');
    });
    return card;
  }

  function buildClusterGrid(servers) {
    var grid = document.createElement('div');
    grid.className = 'cluster-cards';
    servers.forEach(function (s) { grid.appendChild(buildClusterCard(s)); });
    return grid;
  }

  // Same grouping as the desktop dashboard: ungrouped servers first in a plain grid, then
  // each named group (in the order the already-sorted /api/servers response puts them -
  // alphabetical) in its own collapsible section, open by default.
  function renderClusterCards(servers) {
    clusterCardsEl.innerHTML = '';
    var ungrouped = servers.filter(function (s) { return !s.group; });
    var groupNames = [];
    servers.forEach(function (s) {
      if (s.group && groupNames.indexOf(s.group) === -1) groupNames.push(s.group);
    });

    if (ungrouped.length) clusterCardsEl.appendChild(buildClusterGrid(ungrouped));

    groupNames.forEach(function (groupName) {
      var details = document.createElement('details');
      details.className = 'cluster-group';
      details.open = true;
      var summary = document.createElement('summary');
      summary.textContent = groupName;
      details.appendChild(summary);
      details.appendChild(buildClusterGrid(servers.filter(function (s) { return s.group === groupName; })));
      clusterCardsEl.appendChild(details);
    });
  }

  var backupServerNameEl = document.getElementById('backup-server-name');
  var backupNoServerEl = document.getElementById('backup-no-server');
  var backupContentEl = document.getElementById('backup-content');
  var backupInfoEl = document.getElementById('backup-info');
  var backupTableBody = document.getElementById('backup-table-body');
  var backupShowMoreBtn = document.getElementById('btn-backup-show-more');
  var backupLogEl = document.getElementById('backup-log');
  var createBackupBtn = document.getElementById('btn-backup-create');
  var refreshBackupBtn = document.getElementById('btn-backup-refresh');
  if (role && !canOperate) createBackupBtn.style.display = 'none';

  // On a phone, a long backup list (whatever the Backups tab's retention setting keeps -
  // could be well beyond 10) is a lot of scrolling just to reach the process log below it.
  // Cap it there by default, with a button to see the rest. Desktop always shows everything.
  var BACKUP_PAGE_SIZE = 10;
  var backupShowAll = false;
  function isMobileWidth() {
    return window.matchMedia('(max-width: 700px)').matches;
  }

  function formatBackupSize(bytes) {
    var mb = bytes / (1024 * 1024);
    return mb >= 1 ? mb.toFixed(1) + ' MB' : (bytes / 1024).toFixed(0) + ' KB';
  }

  function backupAction(path, filePath) {
    return fetch('/api/servers/' + encodeURIComponent(currentId) + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: filePath })
    })
      .then(function (r) { return r.json(); })
      .then(function (result) {
        if (!result.ok) { showToast('Error: ' + result.error); return; }
        loadBackupView();
      })
      .catch(function () { showToast('Request failed'); });
  }

  function renderBackupTable(backups) {
    backupTableBody.innerHTML = '';
    if (backups.length === 0) {
      var emptyRow = document.createElement('tr');
      var emptyCell = document.createElement('td');
      emptyCell.colSpan = 4;
      emptyCell.className = 'empty-state';
      emptyCell.textContent = 'No backups yet.';
      emptyRow.appendChild(emptyCell);
      backupTableBody.appendChild(emptyRow);
      backupShowMoreBtn.style.display = 'none';
      return;
    }

    var capped = isMobileWidth() && !backupShowAll && backups.length > BACKUP_PAGE_SIZE;
    var visibleBackups = capped ? backups.slice(0, BACKUP_PAGE_SIZE) : backups;

    if (isMobileWidth() && backups.length > BACKUP_PAGE_SIZE) {
      backupShowMoreBtn.style.display = 'block';
      backupShowMoreBtn.textContent = capped ? 'Show all ' + backups.length + ' backups' : 'Show fewer';
      backupShowMoreBtn.onclick = function () {
        backupShowAll = !backupShowAll;
        renderBackupTable(backups);
      };
    } else {
      backupShowMoreBtn.style.display = 'none';
    }

    visibleBackups.forEach(function (b) {
      var row = document.createElement('tr');
      var nameCell = document.createElement('td');
      nameCell.textContent = b.fileName;
      var sizeCell = document.createElement('td');
      sizeCell.textContent = formatBackupSize(b.sizeBytes);
      var timeCell = document.createElement('td');
      timeCell.textContent = new Date(b.createdAt).toLocaleString();

      var actionsCell = document.createElement('td');
      actionsCell.className = 'backup-row-actions';
      if (!role || canAdmin) {
        var restoreBtn = document.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.textContent = 'Restore';
        restoreBtn.addEventListener('click', function () {
          if (!confirm('Restore ' + b.fileName + '? This overwrites the current save.')) return;
          void backupAction('/backups/restore', b.filePath);
        });
        var deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', function () {
          if (!confirm('Delete ' + b.fileName + '?')) return;
          void backupAction('/backups/delete', b.filePath);
        });
        actionsCell.appendChild(restoreBtn);
        actionsCell.appendChild(deleteBtn);
      }

      row.appendChild(nameCell);
      row.appendChild(sizeCell);
      row.appendChild(timeCell);
      row.appendChild(actionsCell);
      backupTableBody.appendChild(row);
    });
  }

  function renderBackupLog(entries) {
    backupLogEl.innerHTML = '';
    if (entries.length === 0) {
      var empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No backup activity yet.';
      backupLogEl.appendChild(empty);
      return;
    }
    entries.forEach(function (entry) {
      var line = document.createElement('div');
      line.className = 'backup-log-line' + (entry.level === 'error' ? ' error' : '');
      var time = document.createElement('span');
      time.className = 'backup-log-time';
      time.textContent = new Date(entry.timestamp).toLocaleTimeString();
      line.appendChild(time);
      line.appendChild(document.createTextNode(entry.message));
      backupLogEl.appendChild(line);
    });
    backupLogEl.scrollTop = backupLogEl.scrollHeight;
  }

  // The Backup view has no server picker of its own - it always follows whichever server
  // is selected in the Dashboard view (currentId).
  function loadBackupView() {
    var id = currentId;
    if (!id) {
      backupServerNameEl.textContent = '';
      backupNoServerEl.style.display = '';
      backupContentEl.classList.remove('active');
      return;
    }
    backupNoServerEl.style.display = 'none';
    backupContentEl.classList.add('active');
    backupServerNameEl.textContent = select.options[select.selectedIndex] ? select.options[select.selectedIndex].textContent : '';

    fetch('/api/servers/' + encodeURIComponent(id) + '/backups/status')
      .then(function (r) { return r.json(); })
      .then(function (status) {
        if (id !== currentId) return;
        if (!status.backupDir) {
          backupInfoEl.textContent = "No backup directory set - configure it in the Manager's Backups tab first.";
          return;
        }
        var scheduleText = !status.scheduleEnabled
          ? 'no schedule'
          : status.scheduleActive
            ? 'scheduled (' + status.scheduleCron + ')'
            : 'scheduled but not currently armed';
        backupInfoEl.textContent = 'Directory: ' + status.backupDir + ' - keeping last ' + status.maxBackups + ' - ' + scheduleText;
      });
    fetch('/api/servers/' + encodeURIComponent(id) + '/backups')
      .then(function (r) { return r.json(); })
      .then(function (backups) { if (id === currentId) renderBackupTable(backups); });
    fetch('/api/servers/' + encodeURIComponent(id) + '/backups/log')
      .then(function (r) { return r.json(); })
      .then(function (entries) { if (id === currentId) renderBackupLog(entries); });
  }

  createBackupBtn.addEventListener('click', function () {
    if (!currentId) return;
    createBackupBtn.disabled = true;
    createBackupBtn.textContent = 'Creating...';
    fetch('/api/servers/' + encodeURIComponent(currentId) + '/backups', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (result) {
        if (!result.ok) showToast('Error: ' + result.error);
        loadBackupView();
      })
      .catch(function () { showToast('Request failed'); })
      .finally(function () {
        createBackupBtn.disabled = false;
        createBackupBtn.textContent = 'Create backup now';
      });
  });

  refreshBackupBtn.addEventListener('click', function () { loadBackupView(); });

  // Keeps the process log live while this view is open, same cadence as everything else
  // here - the table/status info only need refreshing after an action or a view switch.
  setInterval(function () {
    if (activeView !== 'backup' || !currentId) return;
    var id = currentId;
    fetch('/api/servers/' + encodeURIComponent(id) + '/backups/log')
      .then(function (r) { return r.json(); })
      .then(function (entries) { if (id === currentId) renderBackupLog(entries); });
  }, 5000);

  function loadLabelSettings() {
    fetch('/api/labelsettings').then(function (r) { return r.json(); }).then(function (settings) {
      filtersEl.innerHTML = '';
      var title = document.createElement('span');
      title.textContent = 'Show:';
      filtersEl.appendChild(title);
      Object.keys(settings).forEach(function (label) {
        var wrapper = document.createElement('label');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = settings[label];
        if (role && !canAdmin) cb.disabled = true;
        cb.addEventListener('change', function () {
          fetch('/api/labelsettings/' + encodeURIComponent(label), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: cb.checked })
          });
        });
        wrapper.appendChild(cb);
        wrapper.appendChild(document.createTextNode(label));
        filtersEl.appendChild(wrapper);
      });
    });
  }

  function nowTs() {
    return new Date().toTimeString().slice(0, 8);
  }

  var PLAYER_OPEN = String.fromCharCode(1);
  var PLAYER_CLOSE = String.fromCharCode(2);

  // Renders event text as plain text, except for a JOIN/LEFT event's player name (marked
  // with invisible open/close characters by the parser), which gets its own colored span
  // so only that portion picks up the event's color - not the whole line.
  function renderEventText(container, text) {
    var openIdx = text.indexOf(PLAYER_OPEN);
    var closeIdx = text.indexOf(PLAYER_CLOSE);
    if (openIdx === -1 || closeIdx === -1 || closeIdx < openIdx) {
      container.textContent = text;
      return;
    }
    if (openIdx > 0) container.appendChild(document.createTextNode(text.slice(0, openIdx)));
    var playerSpan = document.createElement('span');
    playerSpan.className = 'player';
    playerSpan.textContent = text.slice(openIdx + 1, closeIdx);
    container.appendChild(playerSpan);
    var after = text.slice(closeIdx + 1);
    if (after) container.appendChild(document.createTextNode(after));
  }

  function addEvent(ev) {
    var div = document.createElement('div');
    div.className = 'log-event log-event-' + ev.cls;
    var ts = document.createElement('span'); ts.className = 'ts'; ts.textContent = ev.ts;
    var label = document.createElement('span'); label.className = 'label'; label.textContent = ev.label;
    var text = document.createElement('span'); text.className = 'text';
    renderEventText(text, ev.text);
    div.appendChild(ts); div.appendChild(label); div.appendChild(text);
    consoleEl.appendChild(div);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  function renderStatus(s) {
    statusEl.innerHTML = '';
    if (!s) {
      startBtn.disabled = true; stopBtn.disabled = true; restartBtn.disabled = true; stopUpdateRestartBtn.disabled = true;
      return;
    }
    var lines = document.createElement('div');
    lines.className = 'status-lines';

    var stateLine = document.createElement('div');
    var stateStrong = document.createElement('strong');
    stateStrong.textContent = 'State: ';
    var stateBadge = document.createElement('span');
    stateBadge.className = 'cluster-card-state state-' + s.state;
    stateBadge.textContent = s.state;
    stateLine.appendChild(stateStrong);
    stateLine.appendChild(stateBadge);
    lines.appendChild(stateLine);

    var playerCount = s.players ? s.players.length : 0;
    var pairs = [
      ['Version', s.gameVersion || '-'],
      ['Players', String(playerCount) + (playerCount ? ': ' + s.players.join(', ') : '')],
      ['CPU', s.cpu != null ? s.cpu + '%' : '-'],
      ['RAM', s.memoryMB != null ? s.memoryMB + ' MB' : '-']
    ];
    pairs.forEach(function (pair) {
      var line = document.createElement('div');
      var strong = document.createElement('strong');
      strong.textContent = pair[0] + ': ';
      line.appendChild(strong);
      line.appendChild(document.createTextNode(pair[1]));
      lines.appendChild(line);
    });
    statusEl.appendChild(lines);
    startBtn.disabled = s.state !== 'stopped';
    stopBtn.disabled = s.state !== 'running';
    restartBtn.disabled = s.state !== 'running';
    stopUpdateRestartBtn.disabled = s.state === 'updating';
  }

  function postServerAction(action) {
    if (!currentId) return;
    fetch('/api/servers/' + encodeURIComponent(currentId) + '/' + action, { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (result) {
        if (!result.ok) {
          showToast('Error: ' + result.error);
        } else if (result.saved === false) {
          showToast('Stopped without a confirmed save - RCON may be unreachable');
        }
        loadServers();
      })
      .catch(function () { showToast('Request failed'); });
  }

  startBtn.addEventListener('click', function () { postServerAction('start'); });
  stopBtn.addEventListener('click', function () { postServerAction('stop'); });
  restartBtn.addEventListener('click', function () { postServerAction('restart'); });
  stopUpdateRestartBtn.addEventListener('click', function () {
    if (!confirm('Stop this server, update it via SteamCMD, then start it back up?')) return;
    postServerAction('stop-update-restart');
  });

  var SELECTED_SERVER_KEY = 'ark-dashboard-selected-server';

  function selectServer(id) {
    if (id === currentId) return;
    currentId = id;
    try { localStorage.setItem(SELECTED_SERVER_KEY, id); } catch (err) { /* storage unavailable - not fatal */ }
    backupShowAll = false;
    if (activeView === 'backup') loadBackupView();
    consoleEl.innerHTML = '';
    if (es) { es.close(); es = null; }
    loadPlayers();
    if (!id) return;
    fetch('/api/servers/' + encodeURIComponent(id) + '/events')
      .then(function (r) { return r.json(); })
      .then(function (events) { events.forEach(addEvent); });
    es = new EventSource('/api/servers/' + encodeURIComponent(id) + '/events/stream');
    es.onmessage = function (msg) { addEvent(JSON.parse(msg.data)); };
    es.addEventListener('reset', function () { consoleEl.innerHTML = ''; });
  }

  function loadServers() {
    fetch('/api/servers').then(function (r) { return r.json(); }).then(function (servers) {
      var previousValue = select.value;
      select.innerHTML = '';
      servers.forEach(function (s) {
        var opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name + ' (' + s.state + ')';
        select.appendChild(opt);
      });
      if (previousValue && servers.some(function (s) { return s.id === previousValue; })) {
        select.value = previousValue;
      }
      // A server that was selected can vanish out from under us (profile deleted, or
      // filtered out by Hidden) - treat that the same as never having selected one.
      if (currentId && !servers.some(function (s) { return s.id === currentId; })) {
        currentId = null;
      }
      if (!currentId && servers.length > 0) {
        var remembered = null;
        try { remembered = localStorage.getItem(SELECTED_SERVER_KEY); } catch (err) { /* storage unavailable - not fatal */ }
        var toSelect = remembered && servers.some(function (s) { return s.id === remembered; }) ? remembered : servers[0].id;
        select.value = toSelect;
        selectServer(toSelect);
      }
      // Dashboard and Backup both need a selected server to show anything useful - with
      // none available, default to Cluster Dashboard instead of an empty/stuck view.
      if (!currentId && activeView !== 'cluster') selectView('cluster');
      renderStatus(servers.find(function (s) { return s.id === select.value; }));
      renderClusterCards(servers);
    });
  }

  select.addEventListener('change', function () { selectServer(select.value); });

  rconForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var command = rconInput.value.trim();
    if (!command || !currentId) return;
    rconInput.value = '';
    addEvent({ label: 'RCON', cls: 'rcon-cmd', text: '> ' + command, ts: nowTs() });
    fetch('/api/servers/' + encodeURIComponent(currentId) + '/rcon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: command })
    })
      .then(function (r) { return r.json(); })
      .then(function (result) {
        addEvent({
          label: 'RCON',
          cls: result.ok ? 'rcon-resp' : 'rcon-error',
          text: result.ok ? (result.response || '(no response)') : ('Error: ' + result.error),
          ts: nowTs()
        });
      });
  });

  // Runs after every element/function this (and loadBackupView, if we reload straight
  // into the Backup view) touches has been declared above - calling it any earlier throws
  // on the not-yet-assigned backup-view elements and aborts the rest of this script,
  // including loadServers() below, leaving the page stuck on "no server selected" forever.
  applyActiveView();
  loadServers();
  loadLabelSettings();
  setInterval(loadServers, 5000);
  setInterval(loadPlayers, 5000);
})();
</script>
</body>
</html>
`
