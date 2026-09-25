import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import type { AppSettings, ServerProfile, ServerStatus, WebDashboardRole } from '@shared/types'
import {
  listProfiles,
  getProfile,
  saveProfile,
  getSettings,
  saveSettings,
  listWebDashboardAccessTokens,
  listWebDashboardApiKeys
} from '../store'
import { getStatus, watchLogFile, serverEvents } from './serverProcess'
import { sendRconCommand, parsePlayerListWithIds } from './rcon'
import { parseLogChunk, createLogEventCaches, readLogBacklog } from './logEvents'
import { getGroupConsoleBacklog, watchGroupConsole } from './groupConsole'
import { readClusterStatsHistory, readStatsHistory } from './statsHistory'
import {
  doStartServer,
  doStopServerConfirmSave,
  doRestartServerConfirmSave,
  doUpdateServer,
  doStopUpdateRestart
} from './serverActions'
import { createBackup, listBackups, deleteBackup, restoreBackup, getBackupLog } from './backup'
import { getBackupScheduleStatus } from './schedule'
import { getCachedGameVersion } from './serverVersion'
import { getOrCreateCert } from './tlsCert'
import { verifyPassword, roleAtLeast, getBearerTokenFromRequest, parseApiKey } from './auth'
import { readUpdateLog } from './steamcmd'
import { listMapFolders, createMapFolder, deleteMapFolder } from './mapManagement'
import { listMaps } from './maps'
import { listCustomMaps } from './customMaps'

let server: http.Server | https.Server | null = null
let lastError: string | null = null
let lastHost: string | null = null

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

/** URL-safe stand-in for the (empty-string) ungrouped "group" - an actual empty path
 *  segment invites double-slash URL edge cases the client would rather not construct. */
const UNGROUPED_GROUP_TOKEN = '_ungrouped_'

function resolveGroupProfiles(groupParam: string): ServerProfile[] {
  const groupName = groupParam === UNGROUPED_GROUP_TOKEN ? '' : groupParam
  return sortProfilesForDisplay(listProfiles()).filter((p) => p.group.trim() === groupName)
}

/** `null` or an empty array (including a stored token from before this field existed, or one
 *  saved with nothing checked) means every profile - matching both the pre-scoping behavior
 *  and the Settings UI's "nothing checked = all servers" picker. A `globalAdmin` credential
 *  always has access regardless of `profileIds` - it's the one role scoping was never meant
 *  to apply to; use `admin` for a token that should be restricted to specific servers. */
function hasProfileAccess(auth: RequireRoleResult, profileId: string): boolean {
  if (auth.role === 'globalAdmin') return true
  return !auth.profileIds || auth.profileIds.length === 0 || auth.profileIds.includes(profileId)
}

function filterProfilesForAuth(auth: RequireRoleResult, profiles: ServerProfile[]): ServerProfile[] {
  if (auth.role === 'globalAdmin') return profiles
  if (!auth.profileIds || auth.profileIds.length === 0) return profiles
  const allowed = auth.profileIds
  return profiles.filter((p) => allowed.includes(p.id))
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

interface RequireRoleResult {
  role: WebDashboardRole
  /** `null` = every profile (an API key, or an access token with nothing checked in its
   *  server picker). Only ever restricted for a WebDashboardAccessToken. */
  profileIds: string[] | null
}

/**
 * Gate for every route below `minRole`. When the web dashboard's login requirement is off
 * (the default, unchanged from before this feature existed), this always succeeds with a
 * synthetic full-access role - every route behaves exactly as it did previously. When it's
 * required, the caller must present a valid Bearer credential (`Authorization` header, or a
 * `?token=` query parameter for the two `EventSource` connections that can't set custom
 * headers) matching either a WebDashboardApiKey (bots/scripts) or a WebDashboardAccessToken
 * (pasted into a browser and kept in its own `localStorage`, never a cookie/session) -
 * sending the 401/403 itself and returning null on failure. Callers must `return`
 * immediately when this returns null.
 *
 * A route that operates on one profile or group must additionally check the returned
 * `profileIds` (via hasProfileAccess/filterProfilesForAuth below) - this only checks role,
 * not which servers the credential is scoped to.
 */
async function requireRole(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  minRole: WebDashboardRole
): Promise<RequireRoleResult | null> {
  if (!getSettings().webDashboardAuthEnabled) return { role: 'globalAdmin', profileIds: null }

  const presented = getBearerTokenFromRequest(req)
  const parsed = presented ? parseApiKey(presented) : null
  if (!parsed) {
    sendJson(res, 401, { error: 'Not authenticated' })
    return null
  }

  const apiKey = listWebDashboardApiKeys().find((k) => k.id === parsed.id)
  const accessToken = apiKey ? undefined : listWebDashboardAccessTokens().find((t) => t.id === parsed.id)
  const stored = apiKey ?? accessToken
  const valid = stored ? await verifyPassword(parsed.secret, stored.secretHash) : false
  if (!valid || !stored) {
    sendJson(res, 401, { error: 'Invalid token' })
    return null
  }
  if (!roleAtLeast(stored.role, minRole)) {
    sendJson(res, 403, { error: 'Insufficient permissions' })
    return null
  }
  // apiKey is never profile-scoped; accessToken may be, but a stored token from before this
  // field existed has no profileIds at all (undefined, despite the type) - treat that the
  // same as null (unrestricted).
  return { role: stored.role, profileIds: accessToken?.profileIds ?? null }
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname

  if (req.method === 'GET' && path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(renderDashboardHtml(getSettings().webDashboardAuthEnabled))
    return
  }

  if (req.method === 'GET' && path === '/api/whoami') {
    const auth = await requireRole(req, res, 'readonly')
    if (!auth) return
    sendJson(res, 200, { role: auth.role })
    return
  }

  if (req.method === 'GET' && path === '/api/servers') {
    const auth = await requireRole(req, res, 'readonly')
    if (!auth) return
    const servers = filterProfilesForAuth(auth, sortProfilesForDisplay(listProfiles())).map((profile) => {
      const status = getStatus(profile.id)
      return {
        id: profile.id,
        name: profile.name,
        group: profile.group.trim(),
        maxPlayers: profile.maxPlayers,
        state: status.state,
        players: status.players ?? [],
        cpu: status.cpu ?? null,
        memoryMB: status.memoryMB ?? null,
        startedAt: status.startedAt ?? null,
        gameVersion: getCachedGameVersion(profile.id),
        statsEnabled: profile.statsEnabled
      }
    })
    sendJson(res, 200, servers)
    return
  }

  const eventsMatch = path.match(/^\/api\/servers\/([^/]+)\/events$/)
  if (req.method === 'GET' && eventsMatch) {
    const auth = await requireRole(req, res, 'readonly')
    if (!auth) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(eventsMatch[1]))
    sendJson(res, 200, profile && hasProfileAccess(auth, profile.id) ? readLogBacklog(profile.installDir, getDisabledLabels()) : [])
    return
  }

  const streamMatch = path.match(/^\/api\/servers\/([^/]+)\/events\/stream$/)
  if (req.method === 'GET' && streamMatch) {
    const auth = await requireRole(req, res, 'readonly')
    if (!auth) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(streamMatch[1]))
    if (!profile || !hasProfileAccess(auth, profile.id)) {
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

  const groupEventsMatch = path.match(/^\/api\/groups\/([^/]+)\/events$/)
  if (req.method === 'GET' && groupEventsMatch) {
    const auth = await requireRole(req, res, 'readonly')
    if (!auth) return
    const profiles = filterProfilesForAuth(auth, resolveGroupProfiles(decodeURIComponent(groupEventsMatch[1])))
    const disabled = getDisabledLabels()
    sendJson(
      res,
      200,
      getGroupConsoleBacklog(profiles).filter((event) => !disabled.has(event.label))
    )
    return
  }

  const groupStreamMatch = path.match(/^\/api\/groups\/([^/]+)\/events\/stream$/)
  if (req.method === 'GET' && groupStreamMatch) {
    const auth = await requireRole(req, res, 'readonly')
    if (!auth) return
    const profiles = filterProfilesForAuth(auth, resolveGroupProfiles(decodeURIComponent(groupStreamMatch[1])))
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    res.write('\n')
    const stopWatchingGroup = watchGroupConsole(profiles, (event) => {
      if (getDisabledLabels().has(event.label)) return
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    })
    req.on('close', () => stopWatchingGroup())
    return
  }

  const groupStatsMatch = path.match(/^\/api\/groups\/([^/]+)\/stats$/)
  if (req.method === 'GET' && groupStatsMatch) {
    const auth = await requireRole(req, res, 'readonly')
    if (!auth) return
    const profiles = filterProfilesForAuth(auth, resolveGroupProfiles(decodeURIComponent(groupStatsMatch[1])))
    const sinceParam = url.searchParams.get('since')
    const sinceMs = sinceParam === null || sinceParam === 'null' ? null : Number(sinceParam)
    const maxPointsParam = url.searchParams.get('maxPoints')
    const maxPoints = maxPointsParam !== null ? Number(maxPointsParam) : undefined
    sendJson(
      res,
      200,
      readClusterStatsHistory(
        profiles.map((p) => p.id),
        Number.isFinite(sinceMs) ? sinceMs : null,
        maxPoints
      )
    )
    return
  }

  const serverStatsMatch = path.match(/^\/api\/servers\/([^/]+)\/stats$/)
  if (req.method === 'GET' && serverStatsMatch) {
    const auth = await requireRole(req, res, 'readonly')
    if (!auth) return
    const profileId = decodeURIComponent(serverStatsMatch[1])
    if (!listProfiles().some((p) => p.id === profileId) || !hasProfileAccess(auth, profileId)) {
      sendJson(res, 404, { error: 'Unknown server' })
      return
    }
    const sinceParam = url.searchParams.get('since')
    const sinceMs = sinceParam === null || sinceParam === 'null' ? null : Number(sinceParam)
    const maxPointsParam = url.searchParams.get('maxPoints')
    const maxPoints = maxPointsParam !== null ? Number(maxPointsParam) : undefined
    sendJson(res, 200, readStatsHistory(profileId, Number.isFinite(sinceMs) ? sinceMs : null, maxPoints))
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
    const auth = await requireRole(req, res, 'readonly')
    if (!auth) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(playersMatch[1]))
    if (!profile || !hasProfileAccess(auth, profile.id)) {
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
    const auth = await requireRole(req, res, 'moderator')
    if (!auth) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(startMatch[1]))
    if (!profile || !hasProfileAccess(auth, profile.id)) {
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
    const auth = await requireRole(req, res, 'moderator')
    if (!auth) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(stopMatch[1]))
    if (!profile || !hasProfileAccess(auth, profile.id)) {
      sendJson(res, 404, { ok: false, error: 'Unknown server' })
      return
    }
    const { saved } = await doStopServerConfirmSave(profile)
    sendJson(res, 200, { ok: true, saved })
    return
  }

  const restartMatch = path.match(/^\/api\/servers\/([^/]+)\/restart$/)
  if (req.method === 'POST' && restartMatch) {
    const auth = await requireRole(req, res, 'moderator')
    if (!auth) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(restartMatch[1]))
    if (!profile || !hasProfileAccess(auth, profile.id)) {
      sendJson(res, 404, { ok: false, error: 'Unknown server' })
      return
    }
    const { saved } = await doRestartServerConfirmSave(profile)
    sendJson(res, 200, { ok: true, saved })
    return
  }

  const updateMatch = path.match(/^\/api\/servers\/([^/]+)\/update$/)
  if (req.method === 'POST' && updateMatch) {
    const auth = await requireRole(req, res, 'moderator')
    if (!auth) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(updateMatch[1]))
    if (!profile || !hasProfileAccess(auth, profile.id)) {
      sendJson(res, 404, { ok: false, error: 'Unknown server' })
      return
    }
    doUpdateServer(profile).catch((err: Error) => console.error(`Web dashboard update failed for ${profile.name}:`, err.message))
    sendJson(res, 200, { ok: true })
    return
  }

  const stopUpdateRestartMatch = path.match(/^\/api\/servers\/([^/]+)\/stop-update-restart$/)
  if (req.method === 'POST' && stopUpdateRestartMatch) {
    const auth = await requireRole(req, res, 'moderator')
    if (!auth) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(stopUpdateRestartMatch[1]))
    if (!profile || !hasProfileAccess(auth, profile.id)) {
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
    const auth = await requireRole(req, res, 'moderator')
    if (!auth) return
    const profileId = decodeURIComponent(rconMatch[1])
    const profile = listProfiles().find((p) => p.id === profileId)
    if (!profile || !hasProfileAccess(auth, profile.id)) {
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
    const auth = await requireRole(req, res, 'readonly')
    if (!auth) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(backupStatusMatch[1]))
    if (!profile || !hasProfileAccess(auth, profile.id)) {
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
      nextRunAt: schedule.nextRunAt,
      // Only rendered into an editable form for an admin+ token (see the Backup tab's
      // backup-settings-section) - readonly-gated like the rest of this route since these two
      // fields on their own aren't sensitive, same as everything else already returned here.
      playerProfileBackupEnabled: profile.playerProfileBackupEnabled,
      playerProfileBackupMaxPerPlayer: profile.playerProfileBackupMaxPerPlayer
    })
    return
  }

  const backupLogMatch = path.match(/^\/api\/servers\/([^/]+)\/backups\/log$/)
  if (req.method === 'GET' && backupLogMatch) {
    const auth = await requireRole(req, res, 'readonly')
    if (!auth) return
    const profileId = decodeURIComponent(backupLogMatch[1])
    sendJson(res, 200, hasProfileAccess(auth, profileId) ? getBackupLog(profileId) : [])
    return
  }

  const backupRestoreMatch = path.match(/^\/api\/servers\/([^/]+)\/backups\/restore$/)
  if (req.method === 'POST' && backupRestoreMatch) {
    const auth = await requireRole(req, res, 'admin')
    if (!auth) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(backupRestoreMatch[1]))
    if (!profile || !hasProfileAccess(auth, profile.id)) {
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
    const auth = await requireRole(req, res, 'admin')
    if (!auth) return
    if (!hasProfileAccess(auth, decodeURIComponent(backupDeleteMatch[1]))) {
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
        deleteBackup(filePath)
        sendJson(res, 200, { ok: true })
      })
      .catch((err: Error) => sendJson(res, 400, { ok: false, error: err.message }))
    return
  }

  const backupsMatch = path.match(/^\/api\/servers\/([^/]+)\/backups$/)
  if (req.method === 'GET' && backupsMatch) {
    const auth = await requireRole(req, res, 'readonly')
    if (!auth) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(backupsMatch[1]))
    sendJson(res, 200, profile && hasProfileAccess(auth, profile.id) ? listBackups(profile) : [])
    return
  }
  if (req.method === 'POST' && backupsMatch) {
    const auth = await requireRole(req, res, 'moderator')
    if (!auth) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(backupsMatch[1]))
    if (!profile || !hasProfileAccess(auth, profile.id)) {
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

  // ---- Admin-only remote control: Settings/Mods/Map Management/Update Log - lets an
  // admin-scoped token do everything the desktop Manager's own per-server tabs can, without
  // local file-system access (no directory/file picker dialogs, no "open folder" - those are
  // desktop-only conveniences with no remote equivalent). Server Management has its own
  // narrower, moderator-accessible route pair further down.

  const profileMatch = path.match(/^\/api\/servers\/([^/]+)\/profile$/)
  if (req.method === 'GET' && profileMatch) {
    const auth = await requireRole(req, res, 'admin')
    if (!auth) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(profileMatch[1]))
    if (!profile || !hasProfileAccess(auth, profile.id)) {
      sendJson(res, 404, { error: 'Unknown server' })
      return
    }
    sendJson(res, 200, profile)
    return
  }
  if (req.method === 'POST' && profileMatch) {
    const auth = await requireRole(req, res, 'admin')
    if (!auth) return
    const profile = getProfile(decodeURIComponent(profileMatch[1]))
    if (!profile || !hasProfileAccess(auth, profile.id)) {
      sendJson(res, 404, { ok: false, error: 'Unknown server' })
      return
    }
    readJsonBody(req)
      .then((body) => {
        // id never changes, regardless of what the body sends - every other field is fair
        // game, matching what the desktop Manager's own Settings/Server Management/Mods
        // tabs can already do to this same profile via profiles.save.
        const updated = saveProfile({ ...profile, ...body, id: profile.id } as ServerProfile)
        const saved = updated.find((p) => p.id === profile.id)
        sendJson(res, 200, { ok: true, profile: saved })
      })
      .catch((err: Error) => sendJson(res, 400, { ok: false, error: err.message }))
    return
  }

  // ---- Moderator-accessible remote control: Server Management only - a narrow whitelist of
  // the same ServerProfile fields the Server Management tab edits, kept as its own route (not
  // the admin-only /profile route above) so a moderator token gets this one tab without also
  // reaching Settings/Mods/Map Management/Update Log, which stay admin+.
  const SERVER_MANAGEMENT_FIELDS = [
    'startOnManagerLaunch',
    'crashWatchEnabled',
    'zombieDetectionEnabled',
    'zombieDetectionTimeoutMinutes',
    'zombieDetectionAutoRestart',
    'clusterLogArchiveMaxSizeMB',
    'scheduledRestartEnabled',
    'scheduledRestartTime',
    'scheduledRestartDays',
    'scheduledRestartUpdateAfter',
    'scheduledRestartStartAfter',
    'scheduledDinoWipeEnabled',
    'scheduledDinoWipeTime',
    'scheduledDinoWipeDays'
  ] as const
  function pickServerManagementFields(profile: ServerProfile): Record<string, unknown> {
    const picked: Record<string, unknown> = {}
    for (const field of SERVER_MANAGEMENT_FIELDS) picked[field] = profile[field]
    return picked
  }

  const serverManagementMatch = path.match(/^\/api\/servers\/([^/]+)\/servermanagement$/)
  if (req.method === 'GET' && serverManagementMatch) {
    const auth = await requireRole(req, res, 'moderator')
    if (!auth) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(serverManagementMatch[1]))
    if (!profile || !hasProfileAccess(auth, profile.id)) {
      sendJson(res, 404, { error: 'Unknown server' })
      return
    }
    sendJson(res, 200, pickServerManagementFields(profile))
    return
  }
  if (req.method === 'POST' && serverManagementMatch) {
    const auth = await requireRole(req, res, 'moderator')
    if (!auth) return
    const profile = getProfile(decodeURIComponent(serverManagementMatch[1]))
    if (!profile || !hasProfileAccess(auth, profile.id)) {
      sendJson(res, 404, { ok: false, error: 'Unknown server' })
      return
    }
    readJsonBody(req)
      .then((body) => {
        // Only the whitelisted Server Management fields are accepted here, regardless of what
        // else the body contains - everything else stays reachable only through the admin-only
        // /profile route above.
        const patch: Record<string, unknown> = {}
        for (const field of SERVER_MANAGEMENT_FIELDS) {
          if (field in body) patch[field] = body[field]
        }
        const updated = saveProfile({ ...profile, ...patch, id: profile.id } as ServerProfile)
        const saved = updated.find((p) => p.id === profile.id)
        sendJson(res, 200, { ok: true, profile: saved && pickServerManagementFields(saved) })
      })
      .catch((err: Error) => sendJson(res, 400, { ok: false, error: err.message }))
    return
  }

  const updateLogMatch = path.match(/^\/api\/servers\/([^/]+)\/update-log$/)
  if (req.method === 'GET' && updateLogMatch) {
    const auth = await requireRole(req, res, 'admin')
    if (!auth) return
    const profileId = decodeURIComponent(updateLogMatch[1])
    if (!listProfiles().some((p) => p.id === profileId) || !hasProfileAccess(auth, profileId)) {
      sendJson(res, 404, { log: null })
      return
    }
    sendJson(res, 200, { log: readUpdateLog(profileId) })
    return
  }

  if (req.method === 'GET' && path === '/api/maps') {
    const auth = await requireRole(req, res, 'admin')
    if (!auth) return
    sendJson(res, 200, { maps: listMaps(), customMaps: listCustomMaps() })
    return
  }

  const mapFoldersMatch = path.match(/^\/api\/servers\/([^/]+)\/mapfolders$/)
  if (req.method === 'GET' && mapFoldersMatch) {
    const auth = await requireRole(req, res, 'admin')
    if (!auth) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(mapFoldersMatch[1]))
    if (!profile || !hasProfileAccess(auth, profile.id)) {
      sendJson(res, 404, { error: 'Unknown server' })
      return
    }
    try {
      sendJson(res, 200, listMapFolders(profile))
    } catch (err) {
      sendJson(res, 400, { error: (err as Error).message })
    }
    return
  }
  if (req.method === 'POST' && mapFoldersMatch) {
    const auth = await requireRole(req, res, 'admin')
    if (!auth) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(mapFoldersMatch[1]))
    if (!profile || !hasProfileAccess(auth, profile.id)) {
      sendJson(res, 404, { ok: false, error: 'Unknown server' })
      return
    }
    readJsonBody(req)
      .then((body) => {
        const folderName = typeof body.folderName === 'string' ? body.folderName : ''
        const fileName = typeof body.fileName === 'string' ? body.fileName : ''
        if (!folderName.trim() || !fileName.trim()) {
          sendJson(res, 400, { ok: false, error: 'Missing folderName/fileName' })
          return
        }
        createMapFolder(profile, folderName, fileName)
        sendJson(res, 200, { ok: true })
      })
      .catch((err: Error) => sendJson(res, 400, { ok: false, error: err.message }))
    return
  }

  const mapFoldersDeleteMatch = path.match(/^\/api\/servers\/([^/]+)\/mapfolders\/delete$/)
  if (req.method === 'POST' && mapFoldersDeleteMatch) {
    const auth = await requireRole(req, res, 'admin')
    if (!auth) return
    const profile = listProfiles().find((p) => p.id === decodeURIComponent(mapFoldersDeleteMatch[1]))
    if (!profile || !hasProfileAccess(auth, profile.id)) {
      sendJson(res, 404, { ok: false, error: 'Unknown server' })
      return
    }
    readJsonBody(req)
      .then((body) => {
        const folderName = typeof body.folderName === 'string' ? body.folderName : ''
        if (!folderName.trim()) {
          sendJson(res, 400, { ok: false, error: 'Missing folderName' })
          return
        }
        deleteMapFolder(profile, folderName)
        sendJson(res, 200, { ok: true })
      })
      .catch((err: Error) => sendJson(res, 400, { ok: false, error: err.message }))
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
 *  choice made in Settings, never a default - unless "Require access token" is also turned
 *  on, in which case every route is gated behind a valid token and the server switches to
 *  HTTPS with a self-signed certificate, since a token shouldn't travel in the clear. */
export function startWebDashboard(port: number, host: string): void {
  stopWebDashboard()
  lastError = null
  lastHost = host
  const authEnabled = getSettings().webDashboardAuthEnabled
  if (authEnabled && listWebDashboardAccessTokens().length === 0) {
    lastError = 'Add at least one access token in Settings before enabling it.'
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

/** Splices whether an access token is required at all into the page as
 *  `window.__authRequired` - unlike the old session-cookie design, the server can't know
 *  up front whether *this* browser already has a valid token (it lives only in that
 *  browser's own `localStorage`, never sent until the client's own JS attaches it), so the
 *  same page is always served either way; the client validates any stored token itself via
 *  `GET /api/whoami` once loaded (see the token-gate logic in the client `<script>` below)
 *  and only then learns its role. This flag is not sensitive - it's just "does this
 *  dashboard require a token", not a credential. */
function renderDashboardHtml(authRequired: boolean): string {
  if (!authRequired) return DASHBOARD_HTML
  return DASHBOARD_HTML.replace('<script>', '<script>window.__authRequired = true;</script>\n<script>')
}


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
    --accent: #4f8cff; --danger: #e0555b; --ok: #3fbf6f; --warn: #e0a63f; --cyan: #22d3ee;
    --status-running: #1f8a4c; --status-starting: #7ee6a0; --status-updating: #6fa8ff;
    --status-stopping: #f2878b; --status-stopped: #a83239; --status-restarting: #e0a63f;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    display: flex; height: 100vh; overflow: hidden;
  }
  #token-gate {
    display: none; position: fixed; inset: 0; z-index: 1000; background: var(--bg);
    align-items: center; justify-content: center;
  }
  #token-gate form { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 28px; width: 320px; display: flex; flex-direction: column; gap: 12px; }
  #token-gate h1 { font-size: 1.05rem; margin: 0 0 4px; }
  #token-gate input, #token-gate button { background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 9px 10px; font-size: 0.95rem; }
  #token-gate button { cursor: pointer; background: var(--accent); border-color: var(--accent); color: #fff; }
  #token-gate button:disabled { opacity: 0.6; cursor: not-allowed; }
  #token-gate-error { color: var(--danger); font-size: 0.85rem; min-height: 1.1em; }
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
  #view-cluster.active { display: flex; flex-direction: column; padding: 16px; min-height: 0; }
  #cluster-groups { flex: 1; overflow-y: auto; }
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
  .group-row-online { color: var(--status-running); font-weight: 700; }
  .status-ok { color: var(--status-running); }
  .status-warn { color: var(--danger); }
  .status-offline { color: var(--status-stopping); }
  .group-row-online .group-row-offline { color: var(--muted); font-weight: 400; }
  #cluster-groups.hidden { display: none; }
  .cluster-time-scale { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; font-size: 0.85rem; color: var(--muted); }
  .analytics-stats-toggle { margin-left: auto; }
  .time-scale-btn { padding: 3px 10px; font-size: 0.8rem; }
  .time-scale-btn.active { color: var(--ok); border-color: var(--ok); }
  .cluster-card-chart { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
  .stats-chart-label { display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--muted); }
  .stats-chart-label strong { color: var(--text); }
  .stats-chart-svg-wrap { position: relative; height: 30px; }
  .stats-chart-svg { width: 100%; height: 100%; display: block; }
  .stats-chart-hover-line { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--border); pointer-events: none; }
  .stats-chart-tooltip { position: absolute; top: -20px; transform: translateX(-50%); background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; font-size: 0.65rem; white-space: nowrap; pointer-events: none; }
  #cluster-console { display: none; flex-direction: column; gap: 10px; flex: 1; min-height: 0; }
  #cluster-console.active { display: flex; }
  .cluster-console-header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .cluster-console-header h2 { margin: 0; font-size: 1.05rem; flex: 1; }
  .cluster-console-header button { font-size: 0.8rem; padding: 4px 8px; flex-shrink: 0; }
  /* Reuses the Dashboard view's own .content-row/.panel/.console-panel/.side-col - same
     two-column-on-desktop, stacked-and-collapsible-on-mobile layout as the single-server
     console, so the group console gets the same "console takes the room, side info is a
     collapsible column" shape for free instead of a second bespoke layout. */
  #cluster-console .content-row { flex: 1; min-height: 0; }
  .cluster-console-feed { flex: 1; overflow-y: auto; font-size: 0.82rem; font-family: Consolas, Menlo, monospace; min-height: 200px; }
  .log-event .server-tag { color: #2dd4bf; margin-right: 8px; }
  .log-event-start .label, .log-event-start .text { color: var(--status-running); }
  .log-event-stop .label, .log-event-stop .text { color: var(--status-stopped); }
  .log-event-update .label, .log-event-update .text { color: var(--status-updating); }
  .cluster-console-rcon-form { display: flex; gap: 8px; margin-top: 8px; }
  .cluster-console-rcon-form input, .cluster-console-rcon-form button, .cluster-console-rcon-form select { padding: 10px 14px; font-size: 1rem; border-radius: 8px; }
  .cluster-console-rcon-form select { flex: 0 0 auto; max-width: 40%; }
  .cluster-console-rcon-form input { flex: 1; }
  .cluster-console-rcon-results { font-size: 0.85rem; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; max-height: 120px; overflow-y: auto; margin-top: 8px; }
  .cluster-console-rcon-results p { margin: 2px 0; }
  .rcon-result-ok { color: var(--ok); }
  .rcon-result-error { color: var(--danger); }
  .cluster-console-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; flex-shrink: 0; }
  .cluster-console-stats div { display: flex; flex-direction: column; gap: 2px; }
  .cluster-console-stats dt { color: var(--muted); font-size: 0.72rem; text-transform: uppercase; }
  .cluster-console-stats dd { margin: 0; font-size: 1rem; font-weight: 600; }
  #cluster-console-sidecol { overflow-y: auto; }
  .server-card-mobile { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
  .server-card-mobile-header { display: flex; align-items: center; gap: 8px; }
  .server-card-mobile-header h3 { margin: 0; flex: 1; font-size: 0.98rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .server-card-mobile-menu-btn { flex-shrink: 0; padding: 6px 11px; font-size: 1.1rem; line-height: 1; }
  .server-card-mobile-stats { display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem; color: var(--muted); }
  .server-card-mobile-stats strong { color: var(--text); font-weight: 600; }
  #dashboard-cards { display: flex; flex-direction: column; gap: 20px; }
  .dashboard-group-label { margin: 0 0 8px; font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .dashboard-group-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .dashboard-group-grid .server-card-mobile { cursor: pointer; }
  .action-sheet { position: fixed; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 6px; z-index: 1000; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5); min-width: 170px; }
  .action-sheet button { display: block; width: 100%; text-align: left; border: none; background: none; padding: 9px 12px; border-radius: 6px; font-size: 0.9rem; }
  .action-sheet button:hover:not(:disabled) { background: var(--bg); }
  .action-sheet button.ok { color: var(--ok); }
  .action-sheet button.danger { color: var(--danger); }
  .action-sheet button.warn { color: var(--warn); }
  .action-sheet button.info { color: var(--accent); }
  .action-sheet button.cyan { color: var(--cyan); }
  header { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  header h1 { flex-shrink: 0; }
  .server-picker { margin-left: auto; min-width: 140px; }
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
  #filters-bar, #cluster-console-filters-bar { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
  #btn-toggle-filters { font-size: 0.8rem; padding: 4px 8px; flex-shrink: 0; }
  #filters, #cluster-console-filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; font-size: 0.8rem; color: var(--muted); }
  #filters-bar.collapsed #filters, #cluster-console-filters-bar.collapsed #cluster-console-filters { display: none; }
  #filters label, #cluster-console-filters label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
  #filters input, #cluster-console-filters input { padding: 0; width: auto; }
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
  /* Admin-only remote control tabs (Settings/Mods/Map Management/Server Management/Update
     Log) - reuses the same select/input/button/table/.empty-state/.form-actions styling
     already defined above for the console and backup views, rather than a second bespoke
     visual language. */
  .admin-tab-content { display: none; flex: 1; flex-direction: column; min-height: 0; overflow-y: auto; }
  .admin-tab-content.active { display: flex; }
  .settings-form { display: none; flex: 1; overflow-y: auto; flex-direction: column; gap: 16px; }
  .settings-form.active { display: flex; }
  .settings-section { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
  .settings-section h3 { margin: 0; font-size: 1rem; }
  .settings-section label { display: flex; flex-direction: column; gap: 4px; font-size: 0.8rem; color: var(--muted); }
  .settings-section label.checkbox { flex-direction: row; align-items: center; gap: 6px; color: var(--text); font-size: 0.88rem; }
  .settings-section label.checkbox input { width: auto; }
  .settings-section .form-actions { margin-bottom: 0; }
  .settings-grid2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 16px; }
  .settings-days-row { display: flex; gap: 10px; flex-wrap: wrap; font-size: 0.82rem; }
  .settings-days-row label { flex-direction: row; align-items: center; gap: 4px; color: var(--text); }
  .settings-days-row input { width: auto; }
  .status-message { color: var(--ok); font-size: 0.85rem; }
  button.danger { border-color: var(--danger); color: var(--danger); }
  button.danger:hover:not(:disabled) { background: var(--danger); color: #14161a; }
  .data-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 4px; }
  .data-table th, .data-table td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--border); }
  .data-table th { color: var(--muted); font-weight: 600; }
  .data-table tbody tr.selected { background: var(--bg); }
  .data-table tbody tr.selectable { cursor: pointer; }
  .data-table td.mod-disabled-row { color: var(--muted); }
  .log-output { flex: 1; overflow: auto; font-size: 0.8rem; font-family: Consolas, Menlo, monospace; white-space: pre-wrap; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px; margin: 0; }
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
    .server-picker { margin-left: 0; flex: 1 1 100%; }
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
    /* The stats chart is desktop-only (see the JS width check in buildGroupRow) - this is
       just a safety net so a chart already in the DOM from a resize down from desktop
       width doesn't linger visually before the next poll rebuilds the cards without it. */
    .cluster-time-scale, .cluster-card-chart { display: none; }
    .cluster-console-feed { font-size: 0.72rem; }
    .cluster-console-stats { grid-template-columns: repeat(2, 1fr); gap: 4px 10px; padding: 8px 10px; }
    .cluster-console-stats dt { font-size: 0.62rem; }
    .cluster-console-stats dd { font-size: 0.82rem; }
    .cluster-console-rcon-form { flex-wrap: wrap; }
    .cluster-console-rcon-form select, .cluster-console-rcon-form input { flex: 1 1 auto; max-width: none; }
    .form-actions { flex-wrap: wrap; }
    .form-actions button { flex: 1 1 auto; }
    .backup-table-panel, .backup-log-panel { flex: none; width: 100%; min-width: 0; }
    .backup-table-panel { overflow-x: auto; }
    #backup-table { font-size: 0.78rem; }
    .admin-tab-content, .settings-form { overflow-y: visible; }
    .settings-grid2 { grid-template-columns: 1fr; }
    .data-table { font-size: 0.78rem; }
  }
</style>
</head>
<body>
<div id="token-gate">
  <form id="token-gate-form">
    <h1>ARK Server Manager</h1>
    <input id="token-gate-input" placeholder="Access token" autocomplete="off" autofocus />
    <div id="token-gate-error"></div>
    <button type="submit">Continue</button>
  </form>
</div>
<nav id="sidebar">
  <h1>ARK Manager</h1>
  <button id="nav-dashboard" class="nav-btn" type="button">Dashboard</button>
  <button id="nav-cluster" class="nav-btn" type="button">Cluster Dashboard</button>
  <hr class="nav-sep" />
  <button id="nav-console" class="nav-btn" type="button">Console</button>
  <button id="nav-analytics" class="nav-btn" type="button">Analytics</button>
  <button id="nav-settings" class="nav-btn" type="button">Settings</button>
  <button id="nav-mods" class="nav-btn" type="button">Mods</button>
  <button id="nav-backup" class="nav-btn" type="button">Backup</button>
  <button id="nav-mapmanagement" class="nav-btn" type="button">Map Management</button>
  <button id="nav-servermanagement" class="nav-btn" type="button">Server Management</button>
  <button id="nav-updatelog" class="nav-btn" type="button">Update Log</button>
</nav>
<div id="main-area">
  <section id="view-dashboard" class="view">
    <header>
      <h1>Dashboard</h1>
    </header>
    <main>
      <div id="dashboard-cards"></div>
    </main>
  </section>
  <section id="view-cluster" class="view">
    <div id="cluster-groups">
      <div id="cluster-time-scale" class="cluster-time-scale">
        <span>Time Scale</span>
        <button type="button" class="time-scale-btn" data-ms="60000">1m</button>
        <button type="button" class="time-scale-btn" data-ms="300000">5m</button>
        <button type="button" class="time-scale-btn" data-ms="900000">15m</button>
        <button type="button" class="time-scale-btn" data-ms="3600000">1h</button>
        <button type="button" class="time-scale-btn" data-ms="21600000">6h</button>
        <button type="button" class="time-scale-btn" data-ms="43200000">12h</button>
        <button type="button" class="time-scale-btn" data-ms="86400000">24h</button>
        <button type="button" class="time-scale-btn" data-ms="null">All</button>
      </div>
      <div id="cluster-cards"></div>
    </div>
    <div id="cluster-console">
      <div class="cluster-console-header">
        <button id="btn-cluster-console-back" type="button">&larr; Back</button>
        <h2 id="cluster-console-title"></h2>
        <button id="btn-cluster-toggle-filters" type="button">Show ▾</button>
        <button id="btn-cluster-toggle-sidecol" type="button">Servers ▾</button>
      </div>
      <div id="cluster-console-filters-bar">
        <div id="cluster-console-filters"></div>
      </div>
      <dl id="cluster-console-stats" class="cluster-console-stats"></dl>
      <div class="content-row">
        <section class="panel console-panel">
          <div id="cluster-console-feed" class="cluster-console-feed"></div>
          <div id="cluster-console-rcon-results" class="cluster-console-rcon-results" style="display: none"></div>
          <form id="cluster-console-rcon-form" class="cluster-console-rcon-form">
            <select id="cluster-console-rcon-target"></select>
            <input id="cluster-console-rcon-input" placeholder="RCON command..." autocomplete="off" />
            <button type="submit">Send</button>
          </form>
        </section>
        <div id="cluster-console-sidecol" class="side-col">
          <div id="cluster-console-cards"></div>
        </div>
      </div>
    </div>
  </section>
  <section id="view-console" class="view">
    <header>
      <h1>ARK Server Manager</h1>
      <div id="server-actions">
        <button id="btn-start" class="ok">Start</button>
        <button id="btn-stop" class="danger">Stop</button>
        <button id="btn-restart" class="warn">Restart</button>
        <button id="btn-stop-update-restart" class="info">Update Restart</button>
      </div>
      <button id="btn-toggle-filters" type="button">Events ▾</button>
      <button id="btn-toggle-sidecol" type="button">Status ▾</button>
      <select id="server-select" class="server-picker"></select>
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
  <section id="view-analytics" class="view">
    <header>
      <h1>Analytics</h1>
      <select id="analytics-server-select" class="server-picker"></select>
    </header>
    <main>
      <p id="analytics-no-server" class="empty-state">No server selected - choose one above.</p>
      <div id="analytics-content" class="admin-tab-content">
        <section class="settings-section">
          <h3>Server Status</h3>
          <dl id="analytics-status-grid" class="cluster-console-stats"></dl>
        </section>
        <div id="analytics-time-scale" class="cluster-time-scale">
          <span>Time Scale</span>
          <button type="button" class="time-scale-btn analytics-scale-btn" data-ms="60000">1m</button>
          <button type="button" class="time-scale-btn analytics-scale-btn" data-ms="300000">5m</button>
          <button type="button" class="time-scale-btn analytics-scale-btn" data-ms="900000">15m</button>
          <button type="button" class="time-scale-btn analytics-scale-btn" data-ms="3600000">1h</button>
          <button type="button" class="time-scale-btn analytics-scale-btn" data-ms="21600000">6h</button>
          <button type="button" class="time-scale-btn analytics-scale-btn" data-ms="43200000">12h</button>
          <button type="button" class="time-scale-btn analytics-scale-btn" data-ms="86400000">24h</button>
          <button type="button" class="time-scale-btn analytics-scale-btn" data-ms="null">All</button>
          <label class="checkbox analytics-stats-toggle">
            <input id="analytics-statsenabled" type="checkbox" /> Enable stats collection
          </label>
        </div>
        <p id="analytics-disabled-note" class="empty-state" style="display: none">
          Stats collection is off for this server - enable it above to start recording CPU/RAM/player history.
        </p>
        <div id="analytics-chart"></div>
      </div>
    </main>
  </section>
  <section id="view-backup" class="view">
    <header>
      <h1>Backup</h1>
      <select id="backup-server-select" class="server-picker"></select>
    </header>
    <main>
      <p id="backup-no-server" class="empty-state">No server selected - choose one above.</p>
      <div id="backup-content">
        <section id="backup-settings-section" class="settings-section">
          <h3>Backup Settings</h3>
          <label>
            Backup directory
            <input id="backup-dir" placeholder="C:\\ARK\\Backups" />
          </label>
          <div class="settings-grid2">
            <label>
              Max backups to keep
              <input id="backup-maxbackups" type="number" min="1" />
            </label>
            <label class="checkbox">
              <input id="backup-schedule-enabled" type="checkbox" /> Enable scheduled automatic backups
            </label>
          </div>
          <label>
            Backup schedule (cron expression)
            <input id="backup-schedule-cron" placeholder="every 6 hours: 0 */6 * * *" />
          </label>
          <label class="checkbox">
            <input id="backup-playerprofile-enabled" type="checkbox" /> Back up player profiles on join/leave
          </label>
          <label>
            Backups to keep per player
            <input id="backup-playerprofile-maxperplayer" type="number" min="1" />
          </label>
          <p id="backup-settings-status" class="empty-state" style="display: none"></p>
          <p id="backup-settings-error" class="error-message" style="display: none"></p>
        </section>
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
  <section id="view-settings" class="view">
    <header>
      <h1>Settings</h1>
      <select id="settings-server-select" class="server-picker"></select>
    </header>
    <main>
      <p id="settings-no-server" class="empty-state">No server selected - choose one above.</p>
      <form id="settings-content" class="settings-form" onsubmit="return false;">
        <section class="settings-section">
          <h3>Server</h3>
          <label>
            Name
            <input id="settings-name" />
          </label>
          <label>
            Install directory
            <input id="settings-installdir" placeholder="C:\\ARK\\Server" />
          </label>
          <div class="settings-grid2">
            <label>
              Game port
              <input id="settings-gameport" type="number" />
            </label>
            <label>
              RCON port
              <input id="settings-rconport" type="number" />
            </label>
            <label>
              Server Platform
              <select id="settings-platform">
                <option value="PC">PC</option>
                <option value="ALL">ALL</option>
              </select>
            </label>
            <label>
              Max Players
              <input id="settings-maxplayers" type="number" />
            </label>
          </div>
          <label>
            Map
            <select id="settings-map"></select>
          </label>
          <label>
            Mod Map ID
            <div class="form-actions">
              <input id="settings-moddedmapid" placeholder="Workshop mod id" />
              <label class="checkbox"><input id="settings-moddedmapenabled" type="checkbox" /> Enabled</label>
            </div>
            <p class="empty-state">Passed as -MapModID=&lt;id&gt; when enabled, alongside Map above.</p>
          </label>
          <label>
            Beta
            <div class="form-actions">
              <label class="checkbox"><input id="settings-betaenabled" type="checkbox" /> Enabled</label>
              <input id="settings-betaname" placeholder="Beta branch name" />
            </div>
          </label>
        </section>
        <section class="settings-section">
          <h3>Extra Settings</h3>
          <label>
            Culture Settings
            <select id="settings-culture">
              <option value="none">None</option>
              <option value="en">English</option>
              <option value="fr">French</option>
            </select>
          </label>
          <label class="checkbox"><input id="settings-battleye" type="checkbox" /> Disable BattlEye</label>
          <label class="checkbox"><input id="settings-tribelog" type="checkbox" /> RCON Tribe Log</label>
          <label class="checkbox"><input id="settings-respawndinos" type="checkbox" /> Force Respawn Wild Dinos</label>
          <label class="checkbox"><input id="settings-nosound" type="checkbox" /> No Sound</label>
          <label>
            Dashboard group
            <input id="settings-group" placeholder="Leave blank for no group" />
          </label>
          <label>
            Extra launch arguments
            <input id="settings-extraargs" />
          </label>
        </section>
        <section class="settings-section">
          <h3>Cluster</h3>
          <label class="checkbox"><input id="settings-clusterenabled" type="checkbox" /> Enable cluster</label>
          <label>
            Cluster ID
            <input id="settings-clusterid" placeholder="my-cluster" />
          </label>
          <label>
            Dedicated Cluster Directory
            <input id="settings-clusterdir" />
          </label>
          <label class="checkbox"><input id="settings-notransferfiltering" type="checkbox" /> No Transfer From Filtering</label>
          <label>
            External IP
            <input id="settings-externalip" placeholder="203.0.113.10" />
          </label>
        </section>
        <p id="settings-status" class="status-message" style="display: none"></p>
        <p id="settings-error" class="error-message" style="display: none"></p>
      </form>
    </main>
  </section>
  <section id="view-mods" class="view">
    <header>
      <h1>Mods</h1>
      <select id="mods-server-select" class="server-picker"></select>
    </header>
    <main>
      <p id="mods-no-server" class="empty-state">No server selected - choose one above.</p>
      <div id="mods-content" class="admin-tab-content">
        <p class="empty-state">
          Mod IDs, applied in this order. Enabled mods are passed via -mods= at the next start, unless Passive is
          checked (-passivemods= instead). Dev appends -dev to the ID. Changes save immediately - restart the
          server to apply them.
        </p>
        <div class="form-actions">
          <input id="mods-new-id" placeholder="Mod ID" />
          <button id="btn-mods-add" type="button">Add</button>
        </div>
        <table id="mods-table" class="data-table">
          <thead>
            <tr><th>Enable</th><th>Passive</th><th>Dev</th><th>Name</th><th>Mod ID</th><th></th></tr>
          </thead>
          <tbody id="mods-table-body"></tbody>
        </table>
        <p id="mods-error" class="error-message" style="display: none"></p>
      </div>
    </main>
  </section>
  <section id="view-mapmanagement" class="view">
    <header>
      <h1>Map Management</h1>
      <select id="mapmanagement-server-select" class="server-picker"></select>
    </header>
    <main>
      <p id="mapmanagement-no-server" class="empty-state">No server selected - choose one above.</p>
      <div id="mapmanagement-content" class="admin-tab-content">
        <div class="form-actions">
          <input id="mapmanagement-folder" placeholder="Folder name (e.g. Svartalfheim)" />
          <input id="mapmanagement-file" placeholder="File name (e.g. Svartalfheim_WP.ark)" />
          <button id="btn-mapmanagement-add" type="button">Add map</button>
        </div>
        <p class="empty-state">
          Creates SavedArks/&lt;folder&gt;/&lt;file&gt; (an empty placeholder) under this server's install
          directory. Also add its mod in the Mods tab - that's what actually downloads the map.
        </p>
        <p id="mapmanagement-error" class="error-message" style="display: none"></p>
        <div class="form-actions">
          <button id="btn-mapmanagement-refresh" type="button">Refresh</button>
          <button id="btn-mapmanagement-delete" type="button" class="danger" disabled>Delete selected map</button>
        </div>
        <table id="mapmanagement-table" class="data-table">
          <thead><tr><th>Name</th><th>Creation Date</th></tr></thead>
          <tbody id="mapmanagement-table-body"></tbody>
        </table>
      </div>
    </main>
  </section>
  <section id="view-servermanagement" class="view">
    <header>
      <h1>Server Management</h1>
      <select id="servermanagement-server-select" class="server-picker"></select>
    </header>
    <main>
      <p id="servermanagement-no-server" class="empty-state">No server selected - choose one above.</p>
      <form id="servermanagement-content" class="settings-form" onsubmit="return false;">
        <section class="settings-section">
          <h3>Startup &amp; Watchdog</h3>
          <label class="checkbox">
            <input id="sm-startonlaunch" type="checkbox" /> Start this server when the Manager starts
          </label>
          <label class="checkbox">
            <input id="sm-crashwatch" type="checkbox" /> Automatically restart this server if it crashes unexpectedly
          </label>
          <label class="checkbox">
            <input id="sm-zombiedetection" type="checkbox" /> Kill this server if it gets stuck starting up
          </label>
          <div class="settings-grid2">
            <label>
              Zombie timeout (minutes)
              <input id="sm-zombietimeout" type="number" min="1" />
            </label>
            <label class="checkbox">
              <input id="sm-zombieautorestart" type="checkbox" /> Restart automatically after killing it
            </label>
          </div>
          <label>
            Cluster console archive max size (MB, 1-100)
            <input id="sm-archivesize" type="number" min="1" max="100" />
          </label>
        </section>
        <section class="settings-section">
          <h3>Scheduled Restart</h3>
          <div class="form-actions">
            <label class="checkbox"><input id="sm-restart-enabled" type="checkbox" /> Shutdown server at:</label>
            <input id="sm-restart-time" type="time" />
          </div>
          <div id="sm-restart-days" class="settings-days-row"></div>
          <label class="checkbox"><input id="sm-restart-updateafter" type="checkbox" /> Update server from steam after shutdown</label>
          <label class="checkbox"><input id="sm-restart-startafter" type="checkbox" /> Start server after shutdown</label>
          <p id="sm-restart-countdown" class="empty-state">Next shutdown in: --:--:--:--</p>
        </section>
        <section class="settings-section">
          <h3>Dino Wipe</h3>
          <div class="form-actions">
            <label class="checkbox"><input id="sm-dinowipe-enabled" type="checkbox" /> Wipe wild dinos at:</label>
            <input id="sm-dinowipe-time" type="time" />
          </div>
          <div id="sm-dinowipe-days" class="settings-days-row"></div>
          <p id="sm-dinowipe-countdown" class="empty-state">Next dinowipe in: --:--:--:--</p>
        </section>
        <p id="servermanagement-error" class="error-message" style="display: none"></p>
      </form>
    </main>
  </section>
  <section id="view-updatelog" class="view">
    <header>
      <h1>Update Log</h1>
      <select id="updatelog-server-select" class="server-picker"></select>
    </header>
    <main>
      <p id="updatelog-no-server" class="empty-state">No server selected - choose one above.</p>
      <div id="updatelog-content" class="admin-tab-content">
        <p class="empty-state">
          Output of this server's last SteamCMD install/update run - manual or scheduled. Refreshes every few
          seconds while this tab is open.
        </p>
        <pre id="updatelog-output" class="log-output"></pre>
      </div>
    </main>
  </section>
</div>
<script>
// True only when "Require access token" is on (see renderDashboardHtml in webDashboard.ts);
// stays undefined/false otherwise, in which case the token gate below is skipped entirely
// and the page behaves exactly as it did before this feature existed. Not sensitive - just
// a "does this dashboard require a token" flag, not a credential.
var authRequired = typeof window.__authRequired !== 'undefined' && window.__authRequired;
var ACCESS_TOKEN_KEY = 'ark-dashboard-access-token';
var accessToken = null;
try { accessToken = localStorage.getItem(ACCESS_TOKEN_KEY); } catch (err) { /* storage unavailable - not fatal */ }

// Every fetch call in initDashboard() below goes through window.fetch, so wrapping it here
// once - rather than threading the token through every one of those call sites - is enough
// to authenticate all of them. EventSource can't set custom headers at all, so its two call
// sites append the token as a ?token= query parameter instead (requireRole on the server
// accepts either - see src/main/lib/auth.ts's getBearerTokenFromRequest).
var nativeFetch = window.fetch.bind(window);
window.fetch = function (input, init) {
  init = init || {};
  if (accessToken) {
    var headers = new Headers(init.headers || {});
    headers.set('Authorization', 'Bearer ' + accessToken);
    init.headers = headers;
  }
  return nativeFetch(input, init);
};

function validateAccessToken() {
  return fetch('/api/whoami').then(function (res) {
    if (!res.ok) throw new Error('Invalid token');
    return res.json();
  });
}

var tokenGateEl = document.getElementById('token-gate');
var tokenGateFormEl = document.getElementById('token-gate-form');
var tokenGateInputEl = document.getElementById('token-gate-input');
var tokenGateErrorEl = document.getElementById('token-gate-error');

function showTokenGate(message) {
  tokenGateEl.style.display = 'flex';
  tokenGateErrorEl.textContent = message || '';
}

tokenGateFormEl.addEventListener('submit', function (e) {
  e.preventDefault();
  var value = tokenGateInputEl.value.trim();
  if (!value) return;
  accessToken = value;
  validateAccessToken()
    .then(function (data) {
      try { localStorage.setItem(ACCESS_TOKEN_KEY, accessToken); } catch (err) { /* storage unavailable - not fatal */ }
      tokenGateEl.style.display = 'none';
      initDashboard(data.role);
    })
    .catch(function () {
      accessToken = null;
      tokenGateErrorEl.textContent = 'Invalid access token';
    });
});

if (!authRequired) {
  initDashboard(null);
} else if (accessToken) {
  validateAccessToken()
    .then(function (data) { initDashboard(data.role); })
    .catch(function () {
      accessToken = null;
      try { localStorage.removeItem(ACCESS_TOKEN_KEY); } catch (err) { /* storage unavailable - not fatal */ }
      showTokenGate('Saved access token is no longer valid.');
    });
} else {
  showTokenGate();
}

/** Everything the dashboard page actually does, deferred until we know the caller's role -
 *  either immediately with null (no token required at all) or after a stored/just-entered
 *  access token validates via GET /api/whoami above. role drives the same UI-hiding checks
 *  as before this feature existed (roughly: full access when role is null, otherwise hide
 *  what canOperate/canAdmin don't allow) - the real enforcement is server-side (every route
 *  checks this same role); hiding controls here is just so a role never sees a button that
 *  would 401/403 if clicked. */
function initDashboard(resolvedRole) {
  var role = resolvedRole;
  var canOperate = role === 'moderator' || role === 'admin' || role === 'globalAdmin';
  var canAdmin = role === 'admin' || role === 'globalAdmin';

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

  var navDashboardBtn = document.getElementById('nav-dashboard');
  var navClusterBtn = document.getElementById('nav-cluster');
  var navConsoleBtn = document.getElementById('nav-console');
  var navAnalyticsBtn = document.getElementById('nav-analytics');
  var navBackupBtn = document.getElementById('nav-backup');
  var navSettingsBtn = document.getElementById('nav-settings');
  var navModsBtn = document.getElementById('nav-mods');
  var navMapManagementBtn = document.getElementById('nav-mapmanagement');
  var navServerManagementBtn = document.getElementById('nav-servermanagement');
  var navUpdateLogBtn = document.getElementById('nav-updatelog');
  var viewDashboardEl = document.getElementById('view-dashboard');
  var dashboardCardsEl = document.getElementById('dashboard-cards');
  var viewClusterEl = document.getElementById('view-cluster');
  var viewConsoleEl = document.getElementById('view-console');
  var viewAnalyticsEl = document.getElementById('view-analytics');
  var viewBackupEl = document.getElementById('view-backup');
  var viewSettingsEl = document.getElementById('view-settings');
  var viewModsEl = document.getElementById('view-mods');
  var viewMapManagementEl = document.getElementById('view-mapmanagement');
  var viewServerManagementEl = document.getElementById('view-servermanagement');
  var viewUpdateLogEl = document.getElementById('view-updatelog');
  var clusterCardsEl = document.getElementById('cluster-cards');
  var clusterGroupsEl = document.getElementById('cluster-groups');
  var clusterConsoleEl = document.getElementById('cluster-console');
  var clusterConsoleBackBtn = document.getElementById('btn-cluster-console-back');
  var clusterConsoleTitleEl = document.getElementById('cluster-console-title');
  var clusterConsoleFiltersBarEl = document.getElementById('cluster-console-filters-bar');
  var clusterConsoleFiltersEl = document.getElementById('cluster-console-filters');
  var clusterConsoleToggleFiltersBtn = document.getElementById('btn-cluster-toggle-filters');
  var clusterConsoleStatsEl = document.getElementById('cluster-console-stats');
  var clusterConsoleFeedEl = document.getElementById('cluster-console-feed');
  var clusterConsoleRconResultsEl = document.getElementById('cluster-console-rcon-results');
  var clusterConsoleRconForm = document.getElementById('cluster-console-rcon-form');
  var clusterConsoleRconTargetEl = document.getElementById('cluster-console-rcon-target');
  var clusterConsoleRconInputEl = document.getElementById('cluster-console-rcon-input');
  var clusterConsoleSidecolEl = document.getElementById('cluster-console-sidecol');
  var clusterConsoleToggleSidecolBtn = document.getElementById('btn-cluster-toggle-sidecol');
  var clusterConsoleCardsEl = document.getElementById('cluster-console-cards');

  // Same collapse-to-localStorage pattern as the Dashboard view's own Events/Status
  // toggles above - independent keys, so collapsing one view's filters/side info doesn't
  // affect the other's.
  var CLUSTER_FILTERS_COLLAPSED_KEY = 'ark-dashboard-cluster-filters-collapsed';
  var clusterFiltersCollapsed = false;
  try { clusterFiltersCollapsed = localStorage.getItem(CLUSTER_FILTERS_COLLAPSED_KEY) === '1'; } catch (err) { /* storage unavailable - not fatal */ }

  function applyClusterFiltersCollapsed() {
    clusterConsoleFiltersBarEl.classList.toggle('collapsed', clusterFiltersCollapsed);
    clusterConsoleToggleFiltersBtn.textContent = clusterFiltersCollapsed ? 'Show ▸' : 'Show ▾';
  }
  applyClusterFiltersCollapsed();

  clusterConsoleToggleFiltersBtn.addEventListener('click', function () {
    clusterFiltersCollapsed = !clusterFiltersCollapsed;
    try { localStorage.setItem(CLUSTER_FILTERS_COLLAPSED_KEY, clusterFiltersCollapsed ? '1' : '0'); } catch (err) { /* storage unavailable - not fatal */ }
    applyClusterFiltersCollapsed();
  });

  var CLUSTER_SIDECOL_COLLAPSED_KEY = 'ark-dashboard-cluster-sidecol-collapsed';
  var clusterSidecolCollapsed = false;
  try { clusterSidecolCollapsed = localStorage.getItem(CLUSTER_SIDECOL_COLLAPSED_KEY) === '1'; } catch (err) { /* storage unavailable - not fatal */ }

  function applyClusterSidecolCollapsed() {
    clusterConsoleSidecolEl.classList.toggle('collapsed', clusterSidecolCollapsed);
    clusterConsoleToggleSidecolBtn.textContent = clusterSidecolCollapsed ? 'Servers ▸' : 'Servers ▾';
  }
  applyClusterSidecolCollapsed();

  clusterConsoleToggleSidecolBtn.addEventListener('click', function () {
    clusterSidecolCollapsed = !clusterSidecolCollapsed;
    try { localStorage.setItem(CLUSTER_SIDECOL_COLLAPSED_KEY, clusterSidecolCollapsed ? '1' : '0'); } catch (err) { /* storage unavailable - not fatal */ }
    applyClusterSidecolCollapsed();
  });

  // The Dashboard tab (card grid, admin-only) is always visible like Cluster Dashboard - not
  // gated behind first server selection like the per-server tabs below.
  if (role && !canAdmin) navDashboardBtn.style.display = 'none';
  if (role === 'readonly') navBackupBtn.style.display = 'none';
  // Settings/Mods/Map Management/Update Log stay admin+ only. Server Management is its own,
  // wider tier (moderator+) since moderators are meant to see it per the role's definition.
  var adminNavBtns = [navSettingsBtn, navModsBtn, navMapManagementBtn, navUpdateLogBtn];
  var moderatorNavBtns = [navServerManagementBtn];
  if (role && !canAdmin) {
    adminNavBtns.forEach(function (btn) { btn.style.display = 'none'; });
  }
  if (role && !canOperate) {
    moderatorNavBtns.forEach(function (btn) { btn.style.display = 'none'; });
  }
  // Cluster Dashboard is the main tab now - Dashboard/Backup (and the admin-only/moderator+
  // tabs above) are only relevant once you've actually drilled into a specific server, so they
  // stay out of the sidebar until selectServer() below has been called at least once with a
  // real id (clicking a card in the Cluster Dashboard's group console, or picking one from
  // the Dashboard view's own dropdown once that's reachable some other way). Once shown,
  // they stay shown for the rest of this page's lifetime rather than hiding again if the
  // selection is later cleared (e.g. that server got deleted) - the point is gating first
  // contact, not hiding a tab whose view still works fine with "no server selected".
  var serverEverSelected = false;
  navConsoleBtn.style.display = 'none';
  navAnalyticsBtn.style.display = 'none';
  navBackupBtn.style.display = 'none';
  adminNavBtns.forEach(function (btn) { btn.style.display = 'none'; });
  moderatorNavBtns.forEach(function (btn) { btn.style.display = 'none'; });
  function revealServerScopedNav() {
    if (serverEverSelected) return;
    serverEverSelected = true;
    navConsoleBtn.style.display = '';
    navAnalyticsBtn.style.display = '';
    if (role !== 'readonly') navBackupBtn.style.display = '';
    if (!role || canAdmin) adminNavBtns.forEach(function (btn) { btn.style.display = ''; });
    if (!role || canOperate) moderatorNavBtns.forEach(function (btn) { btn.style.display = ''; });
  }
  if (role && !canOperate) {
    startBtn.style.display = 'none';
    stopBtn.style.display = 'none';
    restartBtn.style.display = 'none';
    stopUpdateRestartBtn.style.display = 'none';
    rconForm.style.display = 'none';
    clusterConsoleRconForm.style.display = 'none';
  }
  if (role) {
    var sidebarEl = document.getElementById('sidebar');
    var logoutBtn = document.createElement('button');
    logoutBtn.className = 'nav-btn nav-logout';
    logoutBtn.type = 'button';
    logoutBtn.textContent = 'Log out (' + role + ')';
    logoutBtn.addEventListener('click', function () {
      accessToken = null;
      try { localStorage.removeItem(ACCESS_TOKEN_KEY); } catch (err) { /* storage unavailable - not fatal */ }
      location.reload();
    });
    sidebarEl.appendChild(logoutBtn);
  }

  // Cluster Dashboard is always the landing tab now - no remembered-last-view restore
  // across page loads, matching "Cluster Dashboard is the main tab" rather than
  // occasionally reopening straight into a single server's Dashboard/Backup/admin view.
  var activeView = 'cluster';

  function applyActiveView() {
    navDashboardBtn.classList.toggle('active', activeView === 'dashboard');
    navClusterBtn.classList.toggle('active', activeView === 'cluster');
    navConsoleBtn.classList.toggle('active', activeView === 'console');
    navAnalyticsBtn.classList.toggle('active', activeView === 'analytics');
    navBackupBtn.classList.toggle('active', activeView === 'backup');
    navSettingsBtn.classList.toggle('active', activeView === 'settings');
    navModsBtn.classList.toggle('active', activeView === 'mods');
    navMapManagementBtn.classList.toggle('active', activeView === 'mapmanagement');
    navServerManagementBtn.classList.toggle('active', activeView === 'servermanagement');
    navUpdateLogBtn.classList.toggle('active', activeView === 'updatelog');
    viewDashboardEl.classList.toggle('active', activeView === 'dashboard');
    viewClusterEl.classList.toggle('active', activeView === 'cluster');
    viewConsoleEl.classList.toggle('active', activeView === 'console');
    viewAnalyticsEl.classList.toggle('active', activeView === 'analytics');
    viewBackupEl.classList.toggle('active', activeView === 'backup');
    viewSettingsEl.classList.toggle('active', activeView === 'settings');
    viewModsEl.classList.toggle('active', activeView === 'mods');
    viewMapManagementEl.classList.toggle('active', activeView === 'mapmanagement');
    viewServerManagementEl.classList.toggle('active', activeView === 'servermanagement');
    viewUpdateLogEl.classList.toggle('active', activeView === 'updatelog');
    if (activeView === 'dashboard') renderDashboardCards(latestServers);
    if (activeView === 'analytics') loadAnalyticsView();
    if (activeView === 'backup') loadBackupView();
    if (activeView === 'settings') loadSettingsView();
    if (activeView === 'mods') loadModsView();
    if (activeView === 'mapmanagement') loadMapManagementView();
    if (activeView === 'servermanagement') loadServerManagementView();
    if (activeView === 'updatelog') loadUpdateLogView();
  }

  function selectView(view) {
    activeView = view;
    applyActiveView();
  }
  navDashboardBtn.addEventListener('click', function () { selectView('dashboard'); });
  navClusterBtn.addEventListener('click', function () { selectView('cluster'); });
  navConsoleBtn.addEventListener('click', function () { selectView('console'); });
  navAnalyticsBtn.addEventListener('click', function () { selectView('analytics'); });
  navBackupBtn.addEventListener('click', function () { selectView('backup'); });
  navSettingsBtn.addEventListener('click', function () { selectView('settings'); });
  navModsBtn.addEventListener('click', function () { selectView('mods'); });
  navMapManagementBtn.addEventListener('click', function () { selectView('mapmanagement'); });
  navServerManagementBtn.addEventListener('click', function () { selectView('servermanagement'); });
  navUpdateLogBtn.addEventListener('click', function () { selectView('updatelog'); });

  // ---- Cluster stats chart (desktop only) ----------------------------------------------
  // Same 1m/5m/15m/1h/6h/12h/24h/All time scales and persistent, server-downsampled history
  // as the desktop Manager's own Cluster Dashboard (src/main/lib/statsHistory.ts) - queried
  // over HTTP (GET /api/groups/:group/stats) once per poll (loadServers() already runs every
  // 5s) instead of sampled/accumulated client-side, so every viewer of this page sees the
  // same history the Manager itself recorded rather than their own separate per-browser
  // copy, and only servers with stats enabled (Analytics tab) contribute to a group's chart.
  var STATS_TIME_SCALES = [
    { label: '1m', ms: 60 * 1000 },
    { label: '5m', ms: 5 * 60 * 1000 },
    { label: '15m', ms: 15 * 60 * 1000 },
    { label: '1h', ms: 60 * 60 * 1000 },
    { label: '6h', ms: 6 * 60 * 60 * 1000 },
    { label: '12h', ms: 12 * 60 * 60 * 1000 },
    { label: '24h', ms: 24 * 60 * 60 * 1000 },
    { label: 'All', ms: null }
  ];
  var STATS_SCALE_KEY = 'web-dashboard-cluster-stats-scale';
  var STATS_MAX_POINTS = 500;
  var DESKTOP_CHART_MIN_WIDTH = 701;
  // Named rather than indexed into STATS_TIME_SCALES so adding/reordering scales can't
  // silently change which one a fresh viewer starts on - matches the desktop Manager's own
  // STATS_DEFAULT_SCALE_MS (src/renderer/src/lib/sparkline.ts).
  var STATS_DEFAULT_SCALE_MS = 12 * 60 * 60 * 1000;

  function loadStoredScale() {
    var raw = null;
    try { raw = localStorage.getItem(STATS_SCALE_KEY); } catch (err) { /* storage unavailable */ }
    if (raw === null) return STATS_DEFAULT_SCALE_MS;
    var parsed = raw === 'null' ? null : Number(raw);
    var known = STATS_TIME_SCALES.some(function (s) { return s.ms === parsed; });
    return known ? parsed : STATS_DEFAULT_SCALE_MS;
  }

  function saveStoredScale(ms) {
    try { localStorage.setItem(STATS_SCALE_KEY, ms === null ? 'null' : String(ms)); } catch (err) { /* storage unavailable - not fatal */ }
  }

  var statsScale = loadStoredScale();
  var MAX_CONTINUOUS_GAP_MS = 60000;

  function buildTimeSeriesPath(samples, windowMs, now, width, height, min, max, maxGapMs) {
    if (samples.length === 0) return '';
    maxGapMs = maxGapMs || MAX_CONTINUOUS_GAP_MS;
    var range = (max - min) || 1;
    var start = now - windowMs;
    var span = windowMs || 1;
    var d = '';
    var previousTime = null;
    samples.forEach(function (s) {
      var x = Math.max(0, Math.min(width, ((s.time - start) / span) * width));
      var y = Math.max(0, Math.min(height, height - ((s.value - min) / range) * height));
      var command = previousTime === null || s.time - previousTime > maxGapMs ? 'M' : 'L';
      d += command + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
      previousTime = s.time;
    });
    return d.trim();
  }

  var STATS_CHART_WIDTH = 1000;
  var STATS_CHART_HEIGHT = 30;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function buildSparkline(label, unit, current, samples, windowMs, now, color, max, maxGapMs) {
    var wrap = document.createElement('div');
    wrap.className = 'stats-chart';

    var labelRow = document.createElement('div');
    labelRow.className = 'stats-chart-label';
    var labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    var currentStrong = document.createElement('strong');
    currentStrong.textContent = current !== undefined ? Math.round(current) + unit : '-';
    labelRow.appendChild(labelSpan);
    labelRow.appendChild(currentStrong);
    wrap.appendChild(labelRow);

    var svgWrap = document.createElement('div');
    svgWrap.className = 'stats-chart-svg-wrap';
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + STATS_CHART_WIDTH + ' ' + STATS_CHART_HEIGHT);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'stats-chart-svg');
    var pathD = buildTimeSeriesPath(samples, windowMs, now, STATS_CHART_WIDTH, STATS_CHART_HEIGHT, 0, max, maxGapMs);
    if (pathD) {
      var path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', pathD);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(path);
    }
    svgWrap.appendChild(svg);

    var hoverLine = document.createElement('div');
    hoverLine.className = 'stats-chart-hover-line';
    hoverLine.style.display = 'none';
    var tooltip = document.createElement('div');
    tooltip.className = 'stats-chart-tooltip';
    tooltip.style.display = 'none';
    svgWrap.appendChild(hoverLine);
    svgWrap.appendChild(tooltip);

    svgWrap.addEventListener('mousemove', function (e) {
      var rect = svgWrap.getBoundingClientRect();
      if (rect.width === 0 || samples.length === 0) return;
      var fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      var targetTime = now - windowMs + fraction * windowMs;
      var nearest = samples[0];
      samples.forEach(function (s) {
        if (Math.abs(s.time - targetTime) < Math.abs(nearest.time - targetTime)) nearest = s;
      });
      var xPercent = (fraction * 100).toFixed(2) + '%';
      hoverLine.style.left = xPercent;
      hoverLine.style.display = 'block';
      tooltip.style.left = xPercent;
      tooltip.style.display = 'block';
      tooltip.textContent = new Date(nearest.time).toLocaleTimeString() + ' · ' + Math.round(nearest.value) + unit;
    });
    svgWrap.addEventListener('mouseleave', function () {
      hoverLine.style.display = 'none';
      tooltip.style.display = 'none';
    });

    wrap.appendChild(svgWrap);
    return wrap;
  }

  function buildClusterChart(history, windowMs, now) {
    var latest = history[history.length - 1];
    var cpuSamples = history.map(function (h) { return { time: h.time, value: h.cpu }; });
    var memorySamples = history.map(function (h) { return { time: h.time, value: h.memoryMB }; });
    var playerSamples = history.map(function (h) { return { time: h.time, value: h.players }; });
    var cpuMax = Math.max(10, cpuSamples.reduce(function (m, s) { return Math.max(m, s.value); }, 0));
    var memoryMax = Math.max(100, memorySamples.reduce(function (m, s) { return Math.max(m, s.value); }, 0));
    // Scaled to the highest player count actually seen (never the group's combined slot
    // count) - against a large combined cap, 0 vs 1 connected player is an imperceptible
    // blip. A floor of 1 keeps an all-zero window from dividing by zero.
    var playersMax = Math.max(1, playerSamples.reduce(function (m, s) { return Math.max(m, s.value); }, 0));
    var maxGapMs = Math.max(MAX_CONTINUOUS_GAP_MS, (windowMs / Math.max(history.length, 1)) * 3);

    var container = document.createElement('div');
    container.className = 'cluster-card-chart';
    container.appendChild(
      buildSparkline('CPU', '%', latest ? latest.cpu : undefined, cpuSamples, windowMs, now, 'var(--accent)', cpuMax, maxGapMs)
    );
    container.appendChild(
      buildSparkline('RAM', ' MB', latest ? latest.memoryMB : undefined, memorySamples, windowMs, now, 'var(--ok)', memoryMax, maxGapMs)
    );
    container.appendChild(
      buildSparkline(
        'Players',
        '',
        latest ? latest.players : undefined,
        playerSamples,
        windowMs,
        now,
        'var(--warn)',
        playersMax,
        maxGapMs
      )
    );
    return container;
  }

  var clusterTimeScaleEl = document.getElementById('cluster-time-scale');
  var timeScaleButtons = Array.prototype.slice.call(document.querySelectorAll('.time-scale-btn'));
  function scaleFromButton(btn) {
    var raw = btn.getAttribute('data-ms');
    return raw === 'null' ? null : Number(raw);
  }
  function updateTimeScaleButtons() {
    timeScaleButtons.forEach(function (btn) {
      btn.classList.toggle('active', scaleFromButton(btn) === statsScale);
    });
  }
  updateTimeScaleButtons();
  timeScaleButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      statsScale = scaleFromButton(btn);
      saveStoredScale(statsScale);
      updateTimeScaleButtons();
      renderClusterCards(latestServers);
    });
  });

  // "Ungrouped" row) - like the desktop Manager's own Cluster Dashboard rows: how many of
  // the group's servers are online (offline count in parens), combined players/max,
  // combined CPU%, combined RAM. Tapping a row opens that group's mobile Group Console.
  // Built from the same /api/servers response loadServers() already fetches every poll,
  // no separate request needed. The desktop-only stats chart is fetched separately and
  // appended to this row once its own request resolves - see renderClusterCards. Returns an
  // "entry" (the row element plus references to the bits that change every poll) rather
  // than just the element, so renderClusterCards can update those in place on later polls
  // instead of tearing down and rebuilding the whole row - see the comment above that
  // function for why that matters.
  function buildGroupRow(g) {
    var card = document.createElement('div');
    card.className = 'cluster-card';

    var header = document.createElement('div');
    header.className = 'cluster-card-header';
    var name = document.createElement('h3');
    name.textContent = g.displayName;
    var online = document.createElement('span');
    online.className = 'group-row-online';
    header.appendChild(name);
    header.appendChild(online);

    var stats = document.createElement('div');
    stats.className = 'cluster-card-stats';
    var playersValue = document.createElement('span');
    var cpuValue = document.createElement('span');
    var ramValue = document.createElement('span');
    var lines = [
      ['Players', playersValue],
      ['CPU', cpuValue],
      ['RAM', ramValue]
    ];
    lines.forEach(function (pair) {
      var line = document.createElement('div');
      var strong = document.createElement('strong');
      strong.textContent = pair[0] + ': ';
      line.appendChild(strong);
      line.appendChild(pair[1]);
      stats.appendChild(line);
    });

    card.appendChild(header);
    card.appendChild(stats);

    card.addEventListener('click', function () { openGroupConsole(g.groupName); });
    return {
      el: card,
      onlineEl: online,
      playersValueEl: playersValue,
      cpuValueEl: cpuValue,
      ramValueEl: ramValue,
      chartEl: null
    };
  }

  function updateGroupRow(entry, g) {
    entry.onlineEl.textContent = g.onlineCount + '/' + g.servers.length;
    var offlineCount = g.servers.length - g.onlineCount;
    if (offlineCount > 0) {
      var offline = document.createElement('span');
      offline.className = 'group-row-offline';
      offline.textContent = ' (' + offlineCount + ' off)';
      entry.onlineEl.appendChild(offline);
    }
    entry.playersValueEl.textContent = g.totalPlayers + '/' + g.totalMaxPlayers;
    entry.cpuValueEl.textContent = g.totalCpu.toFixed(1) + '%';
    entry.ramValueEl.textContent = g.totalMemoryMB + ' MB';
  }

  // Persists across polls (unlike a local variable inside renderClusterCards) so each poll
  // can update an existing row's text/chart in place instead of tearing the whole card list
  // down and rebuilding it from scratch - that used to blank every card (numbers and chart
  // alike) for the moment between the rebuild and the chart's own re-fetch resolving,
  // visible as a distracting flicker every 5s poll even though nothing had actually changed.
  var clusterRowEntries = {};

  // Same grouping/ordering as the desktop dashboard: ungrouped servers first, then each
  // named group alphabetically (the already-sorted /api/servers response puts them in
  // that order already). Plain totals update immediately from data loadServers() already
  // has; the desktop-only stats chart (same persistent store + 6h/12h/24h/All scales as
  // the Manager) is fetched per group from /api/groups/:group/stats and swapped in once it
  // resolves, so a slow/failed fetch never blocks the totals from updating.
  function renderClusterCards(servers) {
    if (clusterTimeScaleEl) clusterTimeScaleEl.style.display = servers.length > 0 ? '' : 'none';
    var byGroup = {};
    var order = [];
    servers.forEach(function (s) {
      var key = s.group || '';
      if (!byGroup[key]) { byGroup[key] = []; order.push(key); }
      byGroup[key].push(s);
    });
    var groups = {};
    var seenKeys = {};
    order.forEach(function (key) {
      var list = byGroup[key];
      var g = {
        groupName: key,
        displayName: key || 'Ungrouped',
        servers: list,
        onlineCount: list.filter(function (s) { return s.state === 'running'; }).length,
        totalPlayers: list.reduce(function (sum, s) { return sum + (s.players ? s.players.length : 0); }, 0),
        totalMaxPlayers: list.reduce(function (sum, s) { return sum + (s.maxPlayers || 0); }, 0),
        totalCpu: list.reduce(function (sum, s) { return sum + (s.cpu || 0); }, 0),
        totalMemoryMB: list.reduce(function (sum, s) { return sum + (s.memoryMB || 0); }, 0)
      };
      groups[key] = g;
      seenKeys[key] = true;
      var entry = clusterRowEntries[key];
      if (!entry) {
        entry = buildGroupRow(g);
        clusterRowEntries[key] = entry;
      }
      updateGroupRow(entry, g);
      // appendChild on a node already in the DOM just moves it - cheap, and doesn't blank
      // or re-flow anything else, so this both adds new rows and keeps existing ones in the
      // right order as the group list changes.
      clusterCardsEl.appendChild(entry.el);
    });

    // A group that no longer has any servers in it (last one moved out, or deleted).
    Object.keys(clusterRowEntries).forEach(function (key) {
      if (seenKeys[key]) return;
      clusterRowEntries[key].el.remove();
      delete clusterRowEntries[key];
    });

    var belowDesktopWidth = window.innerWidth < DESKTOP_CHART_MIN_WIDTH;
    var now = Date.now();
    var sinceParam = statsScale === null ? 'null' : String(now - statsScale);
    order.forEach(function (key) {
      var g = groups[key];
      var entry = clusterRowEntries[key];
      // Nothing running in this group right now, or the window has shrunk below the
      // desktop breakpoint - same as the desktop Manager's own Cluster Dashboard, there's
      // nothing live to show (or no room to show it), and a stale chart would misrepresent
      // the group as merely idle instead of fully down.
      if (belowDesktopWidth || g.onlineCount === 0) {
        if (entry.chartEl) { entry.chartEl.remove(); entry.chartEl = null; }
        return;
      }
      var urlToken = key ? encodeURIComponent(key) : UNGROUPED_TOKEN;
      fetch('/api/groups/' + urlToken + '/stats?since=' + sinceParam + '&maxPoints=' + STATS_MAX_POINTS)
        .then(function (res) { return res.ok ? res.json() : []; })
        .then(function (history) {
          if (!Array.isArray(history) || history.length === 0) return;
          // The group (or its row) may have disappeared while this fetch was in flight.
          var currentEntry = clusterRowEntries[key];
          if (!currentEntry) return;
          var windowMs = statsScale !== null ? statsScale : Math.max(1, Date.now() - history[0].time);
          var chart = buildClusterChart(history, windowMs, Date.now());
          chart.addEventListener('click', function (e) { e.stopPropagation(); });
          // Swaps the old chart for the new one in a single operation (or just appends if
          // there wasn't one yet) instead of removing then re-adding, so there's never a
          // moment where the row has no chart at all.
          if (currentEntry.chartEl) currentEntry.chartEl.replaceWith(chart);
          else currentEntry.el.appendChild(chart);
          currentEntry.chartEl = chart;
        })
        .catch(function () { /* stats chart is best-effort - totals above already updated */ });
    });
  }

  // ---- Mobile Group Console (drills down from a group row above) ----------------------

  var UNGROUPED_TOKEN = '_ungrouped_';
  var CLUSTER_ALL_LABELS = ['JOIN', 'LEFT', 'CHAT', 'WARN', 'KILL', 'TAME', 'CMD', 'SAVE', 'CRYO', 'MISSION', 'READY', 'START', 'STOP', 'UPDATE'];
  var CLUSTER_VISIBLE_LABELS_KEY = 'ark-dashboard-cluster-visible-labels';
  var CLUSTER_AUTOSCROLL_KEY = 'ark-dashboard-cluster-autoscroll';
  var clusterAutoScroll = false;
  try { clusterAutoScroll = localStorage.getItem(CLUSTER_AUTOSCROLL_KEY) === '1'; } catch (err) { /* storage unavailable - not fatal */ }
  var clusterConsoleGroup = null; // null = showing the group list; otherwise the raw group name ('' for ungrouped)
  var clusterConsoleServers = [];
  var clusterEs = null;
  var latestServers = [];
  // Tracks every server's last-seen state for as long as this tab stays open (not tied to
  // the console being open) - mirrors the desktop Manager's module-scope lastKnownStates
  // map, so a transition that happens while you're on a different tab still gets caught
  // and reflected next time you look, instead of that server's now-current state quietly
  // becoming the new unremarked baseline.
  var clusterLastKnownStates = {};

  function loadClusterVisibleLabels() {
    var stored = null;
    try { stored = JSON.parse(localStorage.getItem(CLUSTER_VISIBLE_LABELS_KEY) || 'null'); } catch (err) { /* storage unavailable - not fatal */ }
    if (!Array.isArray(stored)) return CLUSTER_ALL_LABELS.slice();
    return stored.filter(function (l) { return CLUSTER_ALL_LABELS.indexOf(l) !== -1; });
  }
  var clusterVisibleLabels = loadClusterVisibleLabels();
  function saveClusterVisibleLabels() {
    try { localStorage.setItem(CLUSTER_VISIBLE_LABELS_KEY, JSON.stringify(clusterVisibleLabels)); } catch (err) { /* storage unavailable - not fatal */ }
  }

  function applyClusterEventFilter() {
    Array.prototype.forEach.call(clusterConsoleFeedEl.children, function (el) {
      el.style.display = clusterVisibleLabels.indexOf(el.getAttribute('data-label')) !== -1 ? '' : 'none';
    });
  }

  function renderClusterConsoleFilters() {
    clusterConsoleFiltersEl.innerHTML = '';
    var title = document.createElement('span');
    title.textContent = 'Show:';
    clusterConsoleFiltersEl.appendChild(title);
    CLUSTER_ALL_LABELS.forEach(function (label) {
      var wrapper = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = clusterVisibleLabels.indexOf(label) !== -1;
      cb.addEventListener('change', function () {
        var idx = clusterVisibleLabels.indexOf(label);
        if (cb.checked && idx === -1) clusterVisibleLabels.push(label);
        if (!cb.checked && idx !== -1) clusterVisibleLabels.splice(idx, 1);
        saveClusterVisibleLabels();
        applyClusterEventFilter();
      });
      wrapper.appendChild(cb);
      wrapper.appendChild(document.createTextNode(label));
      clusterConsoleFiltersEl.appendChild(wrapper);
    });
    var autoScrollWrapper = document.createElement('label');
    var autoScrollCb = document.createElement('input');
    autoScrollCb.type = 'checkbox';
    autoScrollCb.checked = clusterAutoScroll;
    autoScrollCb.addEventListener('change', function () {
      clusterAutoScroll = autoScrollCb.checked;
      try { localStorage.setItem(CLUSTER_AUTOSCROLL_KEY, clusterAutoScroll ? '1' : '0'); } catch (err) { /* storage unavailable - not fatal */ }
    });
    autoScrollWrapper.appendChild(autoScrollCb);
    autoScrollWrapper.appendChild(document.createTextNode('Auto-scroll'));
    clusterConsoleFiltersEl.appendChild(autoScrollWrapper);
  }

  // "YYYY.MM.DD" (ARK's own log date format, as sent by the merged-backlog/stream) -> "DD/MM".
  function formatDateDDMM(date) {
    var parts = date.split('.');
    return parts.length === 3 ? parts[2] + '/' + parts[1] : date;
  }

  // Same event line as the single-server console, plus the merged feed's date prefix and
  // [Server Name] tag, and no visible label tag for the synthetic START/STOP lines (the
  // label still drives the Show filter above, it's just not printed on the line itself).
  function addClusterEvent(ev) {
    var div = document.createElement('div');
    div.className = 'log-event log-event-' + ev.cls;
    div.setAttribute('data-label', ev.label);
    if (clusterVisibleLabels.indexOf(ev.label) === -1) div.style.display = 'none';
    var ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = formatDateDDMM(ev.date) + ' ' + ev.ts;
    var tag = document.createElement('span');
    tag.className = 'server-tag';
    tag.textContent = '[' + ev.profileName + ']';
    div.appendChild(ts);
    div.appendChild(tag);
    if (ev.label !== 'START' && ev.label !== 'STOP' && ev.label !== 'UPDATE') {
      var label = document.createElement('span');
      label.className = 'label';
      label.textContent = ev.label;
      div.appendChild(label);
    }
    var text = document.createElement('span');
    text.className = 'text';
    renderEventText(text, ev.text);
    div.appendChild(text);
    clusterConsoleFeedEl.appendChild(div);
    if (clusterAutoScroll) clusterConsoleFeedEl.scrollTop = clusterConsoleFeedEl.scrollHeight;
  }

  function renderClusterConsoleStats(servers) {
    var onlineCount = servers.filter(function (s) { return s.state === 'running'; }).length;
    var offlineCount = servers.length - onlineCount;
    var entries = [
      ['Online', onlineCount + ' (' + offlineCount + ' off)'],
      ['Players', String(servers.reduce(function (sum, s) { return sum + (s.players ? s.players.length : 0); }, 0))],
      ['CPU', servers.reduce(function (sum, s) { return sum + (s.cpu || 0); }, 0).toFixed(1) + '%'],
      ['RAM', servers.reduce(function (sum, s) { return sum + (s.memoryMB || 0); }, 0) + ' MB']
    ];
    clusterConsoleStatsEl.innerHTML = '';
    entries.forEach(function (pair) {
      var div = document.createElement('div');
      var dt = document.createElement('dt');
      dt.textContent = pair[0];
      var dd = document.createElement('dd');
      dd.textContent = pair[1];
      div.appendChild(dt);
      div.appendChild(dd);
      clusterConsoleStatsEl.appendChild(div);
    });
  }

  function clusterServerAction(id, action) {
    return fetch('/api/servers/' + encodeURIComponent(id) + '/' + action, { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (result) {
        if (!result.ok) showToast('Error: ' + result.error);
        loadServers();
      })
      .catch(function () { showToast('Request failed'); });
  }

  // Reuses the same contextMenuEl/closeContextMenu wiring the online-players' right-click
  // menu already established (document click/scroll listeners dismiss whichever of the two
  // is open) - just a differently-styled, differently-triggered (tap the card's "..." button
  // instead of right-click) menu of the same shape. Same five actions and color coding as
  // the desktop Manager's own Group Console context menu.
  function openActionSheet(x, y, server) {
    closeContextMenu();
    var menu = document.createElement('div');
    menu.className = 'action-sheet';
    menu.style.visibility = 'hidden';

    function addAction(label, cls, disabled, onClick) {
      var btn = document.createElement('button');
      btn.className = cls;
      btn.textContent = label;
      btn.disabled = !!disabled;
      btn.addEventListener('click', function () {
        closeContextMenu();
        onClick();
      });
      menu.appendChild(btn);
    }

    addAction('Start', 'ok', server.state !== 'stopped', function () { clusterServerAction(server.id, 'start'); });
    addAction('Stop', 'danger', server.state !== 'running', function () { clusterServerAction(server.id, 'stop'); });
    addAction('Restart', 'warn', server.state !== 'running', function () { clusterServerAction(server.id, 'restart'); });
    addAction('Update', 'info', server.state !== 'stopped', function () { clusterServerAction(server.id, 'update'); });
    addAction('Update Restart', 'cyan', false, function () {
      if (!confirm('Stop this server, update it via SteamCMD, then start it back up?')) return;
      clusterServerAction(server.id, 'stop-update-restart');
    });

    document.body.appendChild(menu);
    contextMenuEl = menu;

    // Anchored from the tapped button's position, but clamped so a card near the bottom
    // (or edge) of a small phone screen never opens a menu that's partly or fully
    // unreachable - position:fixed doesn't respond to page scroll, so an overflowing menu
    // would otherwise be stuck off-screen with no way to reach it.
    var rect = menu.getBoundingClientRect();
    var left = Math.min(x, window.innerWidth - rect.width - 8);
    var top = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = Math.max(8, top) + 'px';
    menu.style.visibility = '';
  }

  function buildServerCardMobile(server) {
    var card = document.createElement('div');
    card.className = 'server-card-mobile';

    var header = document.createElement('div');
    header.className = 'server-card-mobile-header';
    var name = document.createElement('h3');
    name.textContent = server.name;
    var state = document.createElement('span');
    state.className = 'cluster-card-state state-' + server.state;
    state.textContent = server.state;
    header.appendChild(name);
    header.appendChild(state);
    if (!role || canOperate) {
      var menuBtn = document.createElement('button');
      menuBtn.type = 'button';
      menuBtn.className = 'server-card-mobile-menu-btn';
      menuBtn.textContent = '⋮';
      menuBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var rect = menuBtn.getBoundingClientRect();
        openActionSheet(rect.right, rect.bottom, server);
      });
      header.appendChild(menuBtn);
    }

    var stats = document.createElement('div');
    stats.className = 'server-card-mobile-stats';
    var playerCount = server.players ? server.players.length : 0;
    var lines = [
      ['Version', server.gameVersion || '-'],
      ['Players', playerCount + '/' + server.maxPlayers],
      ['CPU', server.cpu != null ? server.cpu + '%' : '-'],
      ['RAM', server.memoryMB != null ? server.memoryMB + ' MB' : '-']
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
      selectServer(server.id);
      selectView('console');
    });
    return card;
  }

  // Admin-only Dashboard tab: the same per-server card as the mobile Cluster Dashboard
  // fallback above (click a card to select that profile and jump to its Console, same "⋮"
  // action menu, no separate Manage button), just laid out as a full grid instead of a single
  // mobile column, and grouped like the Settings map dropdown/server pickers - a run of
  // consecutive same-group servers (servers already arrive pre-sorted ungrouped-first-then-
  // alphabetical-by-group) becomes one labeled grid section.
  function renderDashboardCards(servers) {
    dashboardCardsEl.innerHTML = '';
    if (servers.length === 0) {
      var empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No servers yet.';
      dashboardCardsEl.appendChild(empty);
      return;
    }
    var openGroupName = null;
    var openGroupGrid = null;
    servers.forEach(function (server) {
      var group = server.group || '';
      if (group !== openGroupName || !openGroupGrid) {
        openGroupName = group;
        var section = document.createElement('div');
        section.className = 'dashboard-group';
        if (group) {
          var label = document.createElement('h3');
          label.className = 'dashboard-group-label';
          label.textContent = group;
          section.appendChild(label);
        }
        openGroupGrid = document.createElement('div');
        openGroupGrid.className = 'dashboard-group-grid';
        section.appendChild(openGroupGrid);
        dashboardCardsEl.appendChild(section);
      }
      openGroupGrid.appendChild(buildServerCardMobile(server));
    });
  }

  function renderClusterConsoleCards(servers) {
    clusterConsoleCardsEl.innerHTML = '';
    servers.forEach(function (server) { clusterConsoleCardsEl.appendChild(buildServerCardMobile(server)); });
  }

  function renderClusterConsoleRconTargets(servers) {
    var previous = clusterConsoleRconTargetEl.value;
    clusterConsoleRconTargetEl.innerHTML = '';
    var allOpt = document.createElement('option');
    allOpt.value = 'ALL';
    allOpt.textContent = 'ALL';
    clusterConsoleRconTargetEl.appendChild(allOpt);
    servers.forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      clusterConsoleRconTargetEl.appendChild(opt);
    });
    if (previous && (previous === 'ALL' || servers.some(function (s) { return s.id === previous; }))) {
      clusterConsoleRconTargetEl.value = previous;
    }
  }

  // Refreshed every /api/servers poll while a group's console is open - keeps the stats
  // row, server cards and RCON target list current without a separate request.
  function refreshClusterConsoleServers() {
    if (clusterConsoleGroup === null) return;
    clusterConsoleServers = latestServers.filter(function (s) { return (s.group || '') === clusterConsoleGroup; });
    renderClusterConsoleStats(clusterConsoleServers);
    renderClusterConsoleCards(clusterConsoleServers);
    renderClusterConsoleRconTargets(clusterConsoleServers);
  }

  function openGroupConsole(groupName) {
    clusterConsoleGroup = groupName;
    clusterGroupsEl.classList.add('hidden');
    clusterConsoleEl.classList.add('active');
    clusterConsoleTitleEl.textContent = (groupName || 'Ungrouped') + ' — Group Console';
    clusterConsoleFeedEl.innerHTML = '';
    clusterConsoleRconResultsEl.innerHTML = '';
    clusterConsoleRconResultsEl.style.display = 'none';
    renderClusterConsoleFilters();
    refreshClusterConsoleServers();

    var urlToken = groupName ? encodeURIComponent(groupName) : UNGROUPED_TOKEN;
    fetch('/api/groups/' + urlToken + '/events')
      .then(function (r) { return r.json(); })
      .then(function (events) {
        events.forEach(addClusterEvent);
        // Opening the console should land on the latest activity, not the oldest -
        // regardless of the Auto-scroll setting, which only governs whether it keeps
        // following new events from here on.
        clusterConsoleFeedEl.scrollTop = clusterConsoleFeedEl.scrollHeight;
      });

    if (clusterEs) { clusterEs.close(); clusterEs = null; }
    var clusterEsUrl = '/api/groups/' + urlToken + '/events/stream';
    if (accessToken) clusterEsUrl += '?token=' + encodeURIComponent(accessToken);
    clusterEs = new EventSource(clusterEsUrl);
    clusterEs.onmessage = function (msg) { addClusterEvent(JSON.parse(msg.data)); };
  }

  function closeGroupConsole() {
    clusterConsoleGroup = null;
    clusterGroupsEl.classList.remove('hidden');
    clusterConsoleEl.classList.remove('active');
    if (clusterEs) { clusterEs.close(); clusterEs = null; }
  }

  clusterConsoleBackBtn.addEventListener('click', closeGroupConsole);

  clusterConsoleRconForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var command = clusterConsoleRconInputEl.value.trim();
    if (!command || clusterConsoleGroup === null) return;
    var targetValue = clusterConsoleRconTargetEl.value;
    var targets = targetValue === 'ALL' ? clusterConsoleServers : clusterConsoleServers.filter(function (s) { return s.id === targetValue; });
    if (targets.length === 0) return;
    clusterConsoleRconInputEl.value = '';
    Promise.all(targets.map(function (s) {
      return fetch('/api/servers/' + encodeURIComponent(s.id) + '/rcon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: command })
      })
        .then(function (r) { return r.json(); })
        .then(function (result) { return { name: s.name, ok: result.ok, response: result.response, error: result.error }; });
    })).then(function (results) {
      clusterConsoleRconResultsEl.innerHTML = '';
      clusterConsoleRconResultsEl.style.display = results.length ? '' : 'none';
      results.forEach(function (r) {
        var p = document.createElement('p');
        p.className = r.ok ? 'rcon-result-ok' : 'rcon-result-error';
        var strong = document.createElement('strong');
        strong.textContent = r.name + ': ';
        p.appendChild(strong);
        p.appendChild(document.createTextNode(r.ok ? (r.response || '(no response)') : r.error));
        clusterConsoleRconResultsEl.appendChild(p);
      });
    });
  });

  // Pops a toast for any server's start/stop transition (regardless of which tab is
  // active), and additionally drops a matching START/STOP line into the currently-open
  // group's console feed if that server belongs to it - same dual notification (transient
  // toast + permanent feed line) as the desktop Manager's own Group Console.
  function checkClusterStateTransitions(servers) {
    servers.forEach(function (server) {
      var prevState = clusterLastKnownStates[server.id];
      clusterLastKnownStates[server.id] = server.state;
      if (prevState === undefined || prevState === server.state) return;
      if (server.state !== 'running' && server.state !== 'stopped') return;

      // An update that didn't restart the server ends by going 'updating' -> 'stopped',
      // same as a real stop - without this it'd show/toast as a spurious extra stop right
      // after whichever stop (or none, if it wasn't running) actually preceded the update.
      var isUpdateFinish = server.state === 'stopped' && prevState === 'updating';
      var type = isUpdateFinish ? 'update' : (server.state === 'running' ? 'start' : 'stop');
      var label = type === 'start' ? 'START' : (type === 'update' ? 'UPDATE' : 'STOP');
      var text = server.name + (type === 'start' ? ' started' : (type === 'update' ? ' updated' : ' stopped'));
      showToast(text);

      if (clusterConsoleGroup !== null && (server.group || '') === clusterConsoleGroup) {
        var now = new Date();
        var pad = function (n) { return (n < 10 ? '0' : '') + n; };
        addClusterEvent({
          label: label,
          cls: type,
          text: text,
          ts: pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()),
          date: now.getFullYear() + '.' + pad(now.getMonth() + 1) + '.' + pad(now.getDate()),
          profileId: server.id,
          profileName: server.name
        });
      }
    });
  }

  var backupServerSelectEl = document.getElementById('backup-server-select');
  var backupNoServerEl = document.getElementById('backup-no-server');
  var backupContentEl = document.getElementById('backup-content');
  var backupInfoEl = document.getElementById('backup-info');
  var backupTableBody = document.getElementById('backup-table-body');
  var backupShowMoreBtn = document.getElementById('btn-backup-show-more');
  var backupLogEl = document.getElementById('backup-log');
  var createBackupBtn = document.getElementById('btn-backup-create');
  var refreshBackupBtn = document.getElementById('btn-backup-refresh');
  if (role && !canOperate) createBackupBtn.style.display = 'none';

  // Backup directory/retention/schedule editing - same function as the desktop Manager's own
  // Backups tab, admin+ only (it goes through the same admin-gated /profile route Settings
  // uses), unlike create/restore/delete above which stay at their own, lower tiers.
  var backupSettingsSectionEl = document.getElementById('backup-settings-section');
  var backupDirInput = document.getElementById('backup-dir');
  var backupMaxBackupsInput = document.getElementById('backup-maxbackups');
  var backupScheduleEnabledInput = document.getElementById('backup-schedule-enabled');
  var backupScheduleCronInput = document.getElementById('backup-schedule-cron');
  var backupPlayerProfileEnabledInput = document.getElementById('backup-playerprofile-enabled');
  var backupPlayerProfileMaxInput = document.getElementById('backup-playerprofile-maxperplayer');
  var backupSettingsStatusEl = document.getElementById('backup-settings-status');
  var backupSettingsErrorEl = document.getElementById('backup-settings-error');
  if (role && !canAdmin) backupSettingsSectionEl.style.display = 'none';

  function showBackupSettingsError(message) {
    backupSettingsErrorEl.textContent = message || '';
    backupSettingsErrorEl.style.display = message ? '' : 'none';
  }

  function showBackupSettingsStatus(message) {
    backupSettingsStatusEl.textContent = message || '';
    backupSettingsStatusEl.style.display = message ? '' : 'none';
    if (message) setTimeout(function () { showBackupSettingsStatus(''); }, 2000);
  }

  function saveBackupSettingsField(field, value) {
    if (!currentId) return;
    var id = currentId;
    var body = {};
    body[field] = value;
    showBackupSettingsError('');
    fetch('/api/servers/' + encodeURIComponent(id) + '/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (r) { return r.json(); })
      .then(function (result) {
        if (!result.ok) { showBackupSettingsError(result.error || 'Save failed'); return; }
        if (id !== currentId) return;
        showBackupSettingsStatus('Saved');
        loadBackupView();
      })
      .catch(function () { showBackupSettingsError('Request failed'); });
  }

  backupDirInput.addEventListener('change', function () { saveBackupSettingsField('backupDir', backupDirInput.value); });
  backupMaxBackupsInput.addEventListener('change', function () { saveBackupSettingsField('maxBackups', Number(backupMaxBackupsInput.value)); });
  backupScheduleEnabledInput.addEventListener('change', function () { saveBackupSettingsField('backupScheduleEnabled', backupScheduleEnabledInput.checked); });
  backupScheduleCronInput.addEventListener('change', function () { saveBackupSettingsField('backupSchedule', backupScheduleCronInput.value); });
  backupPlayerProfileEnabledInput.addEventListener('change', function () { saveBackupSettingsField('playerProfileBackupEnabled', backupPlayerProfileEnabledInput.checked); });
  backupPlayerProfileMaxInput.addEventListener('change', function () { saveBackupSettingsField('playerProfileBackupMaxPerPlayer', Number(backupPlayerProfileMaxInput.value)); });

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
      backupNoServerEl.style.display = '';
      backupContentEl.classList.remove('active');
      return;
    }
    backupNoServerEl.style.display = 'none';
    backupContentEl.classList.add('active');

    fetch('/api/servers/' + encodeURIComponent(id) + '/backups/status')
      .then(function (r) { return r.json(); })
      .then(function (status) {
        if (id !== currentId) return;
        if (!status.backupDir) {
          backupInfoEl.textContent = (!role || canAdmin)
            ? 'No backup directory set - configure it below.'
            : "No backup directory set - configure it in the Manager's Backups tab first.";
        } else {
          var scheduleText = !status.scheduleEnabled
            ? 'no schedule'
            : status.scheduleActive
              ? 'scheduled (' + status.scheduleCron + ')'
              : 'scheduled but not currently armed';
          backupInfoEl.textContent = 'Directory: ' + status.backupDir + ' - keeping last ' + status.maxBackups + ' - ' + scheduleText;
        }
        backupDirInput.value = status.backupDir || '';
        backupMaxBackupsInput.value = status.maxBackups;
        backupScheduleEnabledInput.checked = !!status.scheduleEnabled;
        backupScheduleCronInput.value = status.scheduleCron || '';
        backupScheduleCronInput.disabled = !status.scheduleEnabled;
        backupPlayerProfileEnabledInput.checked = !!status.playerProfileBackupEnabled;
        backupPlayerProfileMaxInput.value = status.playerProfileBackupMaxPerPlayer;
        backupPlayerProfileMaxInput.disabled = !status.playerProfileBackupEnabled;
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

  // ---- Admin-only remote control tabs: Update Log, Mods, Map Management, Server
  // Management, Settings - each follows currentId exactly like the Backup view above. Every
  // one of these views now also carries its own server picker in its header (see
  // populateServerPickers/syncServerPickers below), and every write still goes through
  // requireRole('admin') server-side regardless of what this client-side hiding does or
  // doesn't show.

  // -- Analytics ------------------------------------------------------------------------
  // Per-server CPU/RAM/Players history chart - same GET /api/servers/:id/stats route (backed
  // by src/main/lib/statsHistory.ts's readStatsHistory) and the same buildClusterChart/
  // buildSparkline drawing code the Cluster Dashboard's own combined chart already uses
  // above, just fed one server's own samples instead of several summed together. Available
  // to any role (like Dashboard/Backup) - only toggling "Enable stats" itself requires admin,
  // since that's a profile field change going through the same admin-gated
  // POST /api/servers/:id/profile route as Settings/Mods/Server Management.
  var analyticsServerSelectEl = document.getElementById('analytics-server-select');
  var analyticsNoServerEl = document.getElementById('analytics-no-server');
  var analyticsContentEl = document.getElementById('analytics-content');
  var analyticsStatusGridEl = document.getElementById('analytics-status-grid');
  var analyticsStatsEnabledInput = document.getElementById('analytics-statsenabled');
  var analyticsDisabledNoteEl = document.getElementById('analytics-disabled-note');
  var analyticsChartEl = document.getElementById('analytics-chart');
  var analyticsScaleButtons = Array.prototype.slice.call(document.querySelectorAll('.analytics-scale-btn'));
  if (role && !canAdmin) analyticsStatsEnabledInput.disabled = true;

  // Same Server Status box as the desktop Manager's own Analytics tab - State/Version/
  // Players/CPU/RAM come straight from the /api/servers poll loadServers() already runs
  // (renderAnalyticsStatus is just called from there whenever this tab is the active one,
  // same as the Console view's own renderStatus), Uptime ticks locally off startedAt every
  // second like Console's does, and Backup task status/Next backup in reuse the exact same
  // GET /api/servers/:id/backups/status route the Backup tab itself calls.
  var analyticsUptimeValueEl = null;
  var analyticsUptimeStartedAt = null;
  var analyticsUptimeRunning = false;

  function statPair(dt, dd) {
    var wrap = document.createElement('div');
    var dtEl = document.createElement('dt');
    dtEl.textContent = dt;
    var ddEl = document.createElement('dd');
    if (typeof dd === 'string') ddEl.textContent = dd;
    else ddEl.appendChild(dd);
    wrap.appendChild(dtEl);
    wrap.appendChild(ddEl);
    return { wrap: wrap, dd: ddEl };
  }

  function renderAnalyticsStatus() {
    var id = currentId;
    if (!id || activeView !== 'analytics') return;
    var server = latestServers.filter(function (s) { return s.id === id; })[0];
    analyticsStatusGridEl.innerHTML = '';
    if (!server) return;

    var stateBadge = document.createElement('span');
    stateBadge.className = 'cluster-card-state state-' + server.state;
    stateBadge.textContent = server.state;
    analyticsStatusGridEl.appendChild(statPair('State', stateBadge).wrap);

    var playerCount = server.players ? server.players.length : 0;
    analyticsStatusGridEl.appendChild(statPair('Players', playerCount + ' / ' + server.maxPlayers).wrap);
    analyticsStatusGridEl.appendChild(statPair('CPU', server.cpu != null ? server.cpu + '%' : '-').wrap);
    analyticsStatusGridEl.appendChild(statPair('RAM', server.memoryMB != null ? server.memoryMB + ' MB' : '-').wrap);
    analyticsStatusGridEl.appendChild(statPair('Version', server.gameVersion || '-').wrap);

    analyticsUptimeRunning = server.state === 'running';
    analyticsUptimeStartedAt = server.startedAt || null;
    var uptimeValueEl = document.createElement('span');
    uptimeValueEl.textContent = analyticsUptimeRunning && analyticsUptimeStartedAt
      ? formatUptime(Date.now() - analyticsUptimeStartedAt)
      : '-';
    analyticsUptimeValueEl = uptimeValueEl;
    analyticsStatusGridEl.appendChild(statPair('Uptime', uptimeValueEl).wrap);

    fetch('/api/servers/' + encodeURIComponent(id) + '/backups/status')
      .then(function (r) { return r.json(); })
      .then(function (status) {
        if (id !== currentId || activeView !== 'analytics') return;
        var taskText = !analyticsUptimeRunning
          ? 'Offline'
          : !status.scheduleEnabled
            ? 'Deactivate'
            : status.scheduleActive
              ? 'Started'
              : 'Stopped';
        var taskClass = !analyticsUptimeRunning ? 'status-offline' : status.scheduleActive ? 'status-ok' : 'status-warn';
        var taskPair = statPair('Backup task status', taskText);
        taskPair.dd.className = taskClass;
        analyticsStatusGridEl.appendChild(taskPair.wrap);
        if (analyticsUptimeRunning && status.scheduleEnabled) {
          analyticsStatusGridEl.appendChild(
            statPair('Next backup in', status.nextRunAt !== null ? formatCountdown(status.nextRunAt - Date.now()) : '--:--:--:--').wrap
          );
        }
      });
  }

  setInterval(function () {
    if (analyticsUptimeValueEl && analyticsUptimeRunning && analyticsUptimeStartedAt) {
      analyticsUptimeValueEl.textContent = formatUptime(Date.now() - analyticsUptimeStartedAt);
    }
  }, 1000);

  function analyticsScaleKey(id) {
    return 'web-dashboard-analytics-stats-scale:' + id;
  }

  function loadStoredAnalyticsScale(id) {
    var raw = null;
    try { raw = localStorage.getItem(analyticsScaleKey(id)); } catch (err) { /* storage unavailable */ }
    if (raw === null) return STATS_DEFAULT_SCALE_MS;
    var parsed = raw === 'null' ? null : Number(raw);
    var known = STATS_TIME_SCALES.some(function (s) { return s.ms === parsed; });
    return known ? parsed : STATS_DEFAULT_SCALE_MS;
  }

  function saveStoredAnalyticsScale(id, ms) {
    try { localStorage.setItem(analyticsScaleKey(id), ms === null ? 'null' : String(ms)); } catch (err) { /* storage unavailable - not fatal */ }
  }

  var analyticsScale = STATS_DEFAULT_SCALE_MS;

  function updateAnalyticsScaleButtons() {
    analyticsScaleButtons.forEach(function (btn) {
      btn.classList.toggle('active', scaleFromButton(btn) === analyticsScale);
    });
  }

  analyticsScaleButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!currentId) return;
      analyticsScale = scaleFromButton(btn);
      saveStoredAnalyticsScale(currentId, analyticsScale);
      updateAnalyticsScaleButtons();
      refreshAnalyticsChart();
    });
  });

  function refreshAnalyticsChart() {
    var id = currentId;
    if (!id) return;
    var sinceMs = analyticsScale === null ? null : Date.now() - analyticsScale;
    var url = '/api/servers/' + encodeURIComponent(id) + '/stats?maxPoints=' + STATS_MAX_POINTS;
    url += '&since=' + (sinceMs === null ? 'null' : sinceMs);
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (history) {
        if (id !== currentId || activeView !== 'analytics') return;
        analyticsChartEl.innerHTML = '';
        if (history.length === 0) {
          var server = latestServers.filter(function (s) { return s.id === id; })[0];
          var isRunning = server ? server.state === 'running' : false;
          var empty = document.createElement('p');
          empty.className = 'empty-state';
          empty.textContent = isRunning ? 'Collecting data... check back in a few seconds.' : "Server isn't running - start it to see live stats.";
          analyticsChartEl.appendChild(empty);
          return;
        }
        var windowMs = analyticsScale !== null ? analyticsScale : Math.max(1, Date.now() - history[0].time);
        analyticsChartEl.appendChild(buildClusterChart(history, windowMs, Date.now()));
      });
  }

  function loadAnalyticsView() {
    var id = currentId;
    if (!id) {
      analyticsNoServerEl.style.display = '';
      analyticsContentEl.classList.remove('active');
      return;
    }
    analyticsNoServerEl.style.display = 'none';
    analyticsContentEl.classList.add('active');
    analyticsScale = loadStoredAnalyticsScale(id);
    updateAnalyticsScaleButtons();
    renderAnalyticsStatus();
    var server = latestServers.filter(function (s) { return s.id === id; })[0];
    var statsEnabled = server ? !!server.statsEnabled : false;
    analyticsStatsEnabledInput.checked = statsEnabled;
    analyticsDisabledNoteEl.style.display = statsEnabled ? 'none' : '';
    analyticsChartEl.innerHTML = '';
    if (statsEnabled) refreshAnalyticsChart();
  }

  analyticsStatsEnabledInput.addEventListener('change', function () {
    if (!currentId) return;
    var id = currentId;
    var checked = analyticsStatsEnabledInput.checked;
    fetch('/api/servers/' + encodeURIComponent(id) + '/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statsEnabled: checked })
    })
      .then(function (r) { return r.json(); })
      .then(function (result) {
        if (!result.ok) {
          analyticsStatsEnabledInput.checked = !checked;
          showToast('Error: ' + (result.error || 'Save failed'));
          return;
        }
        if (id !== currentId) return;
        analyticsDisabledNoteEl.style.display = checked ? 'none' : '';
        analyticsChartEl.innerHTML = '';
        if (checked) refreshAnalyticsChart();
      })
      .catch(function () {
        analyticsStatsEnabledInput.checked = !checked;
        showToast('Request failed');
      });
  });

  setInterval(function () {
    if (activeView === 'analytics' && currentId && analyticsStatsEnabledInput.checked) refreshAnalyticsChart();
  }, 5000);

  // -- Update Log --------------------------------------------------------------------
  var updatelogServerSelectEl = document.getElementById('updatelog-server-select');
  var updatelogNoServerEl = document.getElementById('updatelog-no-server');
  var updatelogContentEl = document.getElementById('updatelog-content');
  var updatelogOutputEl = document.getElementById('updatelog-output');

  function loadUpdateLogView() {
    var id = currentId;
    if (!id) {
      updatelogNoServerEl.style.display = '';
      updatelogContentEl.classList.remove('active');
      return;
    }
    updatelogNoServerEl.style.display = 'none';
    updatelogContentEl.classList.add('active');
    fetch('/api/servers/' + encodeURIComponent(id) + '/update-log')
      .then(function (r) { return r.json(); })
      .then(function (result) {
        if (id !== currentId) return;
        updatelogOutputEl.textContent = result.log || 'No update log yet - run Update at least once.';
      });
  }

  setInterval(function () {
    if (activeView === 'updatelog' && currentId) loadUpdateLogView();
  }, 4000);

  // -- Mods ---------------------------------------------------------------------------
  var modsServerSelectEl = document.getElementById('mods-server-select');
  var modsNoServerEl = document.getElementById('mods-no-server');
  var modsContentEl = document.getElementById('mods-content');
  var modsNewIdInput = document.getElementById('mods-new-id');
  var btnModsAdd = document.getElementById('btn-mods-add');
  var modsTableBody = document.getElementById('mods-table-body');
  var modsErrorEl = document.getElementById('mods-error');
  var currentMods = [];

  function showModsError(message) {
    modsErrorEl.textContent = message || '';
    modsErrorEl.style.display = message ? '' : 'none';
  }

  function saveMods(next) {
    if (!currentId) return;
    var id = currentId;
    fetch('/api/servers/' + encodeURIComponent(id) + '/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mods: next })
    })
      .then(function (r) { return r.json(); })
      .then(function (result) {
        if (!result.ok) { showModsError(result.error || 'Save failed'); return; }
        if (id !== currentId) return;
        currentMods = result.profile.mods || [];
        renderModsTable();
      })
      .catch(function () { showModsError('Request failed'); });
  }

  function renderModsTable() {
    modsTableBody.innerHTML = '';
    if (currentMods.length === 0) {
      var emptyRow = document.createElement('tr');
      var emptyCell = document.createElement('td');
      emptyCell.colSpan = 6;
      emptyCell.className = 'empty-state';
      emptyCell.textContent = 'No mods configured.';
      emptyRow.appendChild(emptyCell);
      modsTableBody.appendChild(emptyRow);
      return;
    }
    currentMods.forEach(function (mod, index) {
      var row = document.createElement('tr');

      function checkboxCell(field) {
        var td = document.createElement('td');
        var input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!mod[field];
        input.addEventListener('change', function () {
          var updatedMod = Object.assign({}, mod);
          updatedMod[field] = input.checked;
          var next = currentMods.slice();
          next[index] = updatedMod;
          saveMods(next);
        });
        td.appendChild(input);
        return td;
      }
      row.appendChild(checkboxCell('enabled'));
      row.appendChild(checkboxCell('passive'));
      row.appendChild(checkboxCell('dev'));

      var nameCell = document.createElement('td');
      var nameInput = document.createElement('input');
      nameInput.value = mod.name || '';
      nameInput.placeholder = 'Optional label';
      nameInput.addEventListener('change', function () {
        var updatedMod = Object.assign({}, mod, { name: nameInput.value || undefined });
        var next = currentMods.slice();
        next[index] = updatedMod;
        saveMods(next);
      });
      nameCell.appendChild(nameInput);
      row.appendChild(nameCell);

      var idCell = document.createElement('td');
      idCell.textContent = mod.id + (mod.dev ? '-dev' : '');
      row.appendChild(idCell);

      var actionsCell = document.createElement('td');
      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'danger';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', function () {
        saveMods(currentMods.filter(function (m) { return m.id !== mod.id; }));
      });
      actionsCell.appendChild(removeBtn);
      row.appendChild(actionsCell);

      modsTableBody.appendChild(row);
    });
  }

  function loadModsView() {
    var id = currentId;
    if (!id) {
      modsNoServerEl.style.display = '';
      modsContentEl.classList.remove('active');
      return;
    }
    showModsError('');
    modsNoServerEl.style.display = 'none';
    modsContentEl.classList.add('active');
    fetch('/api/servers/' + encodeURIComponent(id) + '/profile')
      .then(function (r) { return r.json(); })
      .then(function (profile) {
        if (id !== currentId) return;
        currentMods = profile.mods || [];
        renderModsTable();
      });
  }

  btnModsAdd.addEventListener('click', function () {
    var idValue = modsNewIdInput.value.trim();
    if (!idValue || currentMods.some(function (m) { return m.id === idValue; })) return;
    saveMods(currentMods.concat([{ id: idValue, enabled: true, passive: false, dev: false }]));
    modsNewIdInput.value = '';
  });

  // -- Map Management -------------------------------------------------------------------
  var mapmanagementServerSelectEl = document.getElementById('mapmanagement-server-select');
  var mapmanagementNoServerEl = document.getElementById('mapmanagement-no-server');
  var mapmanagementContentEl = document.getElementById('mapmanagement-content');
  var mapmanagementFolderInput = document.getElementById('mapmanagement-folder');
  var mapmanagementFileInput = document.getElementById('mapmanagement-file');
  var btnMapManagementAdd = document.getElementById('btn-mapmanagement-add');
  var mapmanagementErrorEl = document.getElementById('mapmanagement-error');
  var btnMapManagementRefresh = document.getElementById('btn-mapmanagement-refresh');
  var btnMapManagementDelete = document.getElementById('btn-mapmanagement-delete');
  var mapmanagementTableBody = document.getElementById('mapmanagement-table-body');
  var mapManagementSelected = '';
  var mapManagementFolders = [];

  function showMapManagementError(message) {
    mapmanagementErrorEl.textContent = message || '';
    mapmanagementErrorEl.style.display = message ? '' : 'none';
  }

  function renderMapManagementTable() {
    mapmanagementTableBody.innerHTML = '';
    if (mapManagementFolders.length === 0) {
      var emptyRow = document.createElement('tr');
      var emptyCell = document.createElement('td');
      emptyCell.colSpan = 2;
      emptyCell.className = 'empty-state';
      emptyCell.textContent = 'No map folders under SavedArks yet.';
      emptyRow.appendChild(emptyCell);
      mapmanagementTableBody.appendChild(emptyRow);
      return;
    }
    mapManagementFolders.forEach(function (folder) {
      var row = document.createElement('tr');
      row.className = 'selectable' + (folder.name === mapManagementSelected ? ' selected' : '');
      row.addEventListener('click', function () {
        mapManagementSelected = folder.name;
        btnMapManagementDelete.disabled = false;
        renderMapManagementTable();
      });
      var nameCell = document.createElement('td');
      nameCell.textContent = folder.name;
      var dateCell = document.createElement('td');
      dateCell.textContent = new Date(folder.createdAt).toLocaleString();
      row.appendChild(nameCell);
      row.appendChild(dateCell);
      mapmanagementTableBody.appendChild(row);
    });
  }

  function loadMapManagementView() {
    var id = currentId;
    if (!id) {
      mapmanagementNoServerEl.style.display = '';
      mapmanagementContentEl.classList.remove('active');
      return;
    }
    showMapManagementError('');
    mapmanagementNoServerEl.style.display = 'none';
    mapmanagementContentEl.classList.add('active');
    mapManagementSelected = '';
    btnMapManagementDelete.disabled = true;
    fetch('/api/servers/' + encodeURIComponent(id) + '/mapfolders')
      .then(function (r) { return r.json(); })
      .then(function (folders) {
        if (id !== currentId) return;
        mapManagementFolders = folders;
        renderMapManagementTable();
      });
  }

  btnMapManagementAdd.addEventListener('click', function () {
    if (!currentId) return;
    var folderName = mapmanagementFolderInput.value.trim();
    var fileName = mapmanagementFileInput.value.trim();
    if (!folderName || !fileName) return;
    showMapManagementError('');
    fetch('/api/servers/' + encodeURIComponent(currentId) + '/mapfolders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderName: folderName, fileName: fileName })
    })
      .then(function (r) { return r.json(); })
      .then(function (result) {
        if (!result.ok) { showMapManagementError(result.error || 'Failed'); return; }
        mapmanagementFolderInput.value = '';
        mapmanagementFileInput.value = '';
        loadMapManagementView();
      })
      .catch(function () { showMapManagementError('Request failed'); });
  });

  btnMapManagementRefresh.addEventListener('click', function () { loadMapManagementView(); });

  btnMapManagementDelete.addEventListener('click', function () {
    if (!currentId || !mapManagementSelected) return;
    if (!confirm('Delete the "' + mapManagementSelected + '" map folder and everything in it?')) return;
    fetch('/api/servers/' + encodeURIComponent(currentId) + '/mapfolders/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderName: mapManagementSelected })
    })
      .then(function (r) { return r.json(); })
      .then(function (result) {
        if (!result.ok) { showMapManagementError(result.error || 'Failed'); return; }
        loadMapManagementView();
      })
      .catch(function () { showMapManagementError('Request failed'); });
  });

  // -- Server Management ---------------------------------------------------------------
  var DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var smServerSelectEl = document.getElementById('servermanagement-server-select');
  var smNoServerEl = document.getElementById('servermanagement-no-server');
  var smContentEl = document.getElementById('servermanagement-content');
  var smErrorEl = document.getElementById('servermanagement-error');
  var smStartOnLaunch = document.getElementById('sm-startonlaunch');
  var smCrashWatch = document.getElementById('sm-crashwatch');
  var smZombieDetection = document.getElementById('sm-zombiedetection');
  var smZombieTimeout = document.getElementById('sm-zombietimeout');
  var smZombieAutoRestart = document.getElementById('sm-zombieautorestart');
  var smArchiveSize = document.getElementById('sm-archivesize');
  var smRestartEnabled = document.getElementById('sm-restart-enabled');
  var smRestartTime = document.getElementById('sm-restart-time');
  var smRestartDaysEl = document.getElementById('sm-restart-days');
  var smRestartUpdateAfter = document.getElementById('sm-restart-updateafter');
  var smRestartStartAfter = document.getElementById('sm-restart-startafter');
  var smDinoWipeEnabled = document.getElementById('sm-dinowipe-enabled');
  var smDinoWipeTime = document.getElementById('sm-dinowipe-time');
  var smDinoWipeDaysEl = document.getElementById('sm-dinowipe-days');
  var smRestartCountdownEl = document.getElementById('sm-restart-countdown');
  var smDinoWipeCountdownEl = document.getElementById('sm-dinowipe-countdown');
  var smProfile = null;

  // Ported from shared/scheduleTime.ts - the client script here is plain JS with no module
  // imports, so this stays a hand-kept copy rather than sharing the source file; the tests
  // for the real one (tests/scheduleTime.test.ts) are the source of truth for the math.
  // NOTE: this whole client script is itself the *value* of a JS template literal
  // (DASHBOARD_HTML, back in the outer main-process source) - an unescaped backslash-d,
  // backslash-w, backslash-s etc. here gets its backslash silently stripped by THAT outer
  // template literal's own string parsing before this text ever reaches the browser (a
  // template literal containing just backslash-d evaluates to the plain string "d" in JS),
  // so every backslash in a regex below must be doubled to survive that one extra layer of
  // parsing intact.
  function parseScheduleTime(time) {
    var match = /^([01]\\d|2[0-3]):([0-5]\\d)$/.exec(time || '');
    if (!match) return null;
    return { hour: Number(match[1]), minute: Number(match[2]) };
  }

  function computeNextOccurrence(now, time, days) {
    var parsed = parseScheduleTime(time);
    if (!parsed || !days || days.length === 0) return null;
    for (var offset = 0; offset <= 7; offset++) {
      var candidate = new Date(now);
      candidate.setDate(now.getDate() + offset);
      candidate.setHours(parsed.hour, parsed.minute, 0, 0);
      if (candidate <= now) continue;
      if (days.indexOf(candidate.getDay()) !== -1) return candidate;
    }
    return null;
  }

  function formatCountdown(ms) {
    var clamped = Math.max(0, ms);
    var totalSeconds = Math.floor(clamped / 1000);
    var seconds = totalSeconds % 60;
    var totalMinutes = Math.floor(totalSeconds / 60);
    var minutes = totalMinutes % 60;
    var totalHours = Math.floor(totalMinutes / 60);
    var hours = totalHours % 24;
    var days = Math.floor(totalHours / 24);
    function pad(n) { return String(n).padStart(2, '0'); }
    return pad(days) + ':' + pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
  }

  function updateSmCountdowns() {
    if (!smProfile) return;
    var now = new Date();
    var restartNext = smProfile.scheduledRestartEnabled
      ? computeNextOccurrence(now, smProfile.scheduledRestartTime, smProfile.scheduledRestartDays)
      : null;
    smRestartCountdownEl.textContent = 'Next shutdown in: ' + (restartNext ? formatCountdown(restartNext.getTime() - now.getTime()) : '--:--:--:--');
    var dinoWipeNext = smProfile.scheduledDinoWipeEnabled
      ? computeNextOccurrence(now, smProfile.scheduledDinoWipeTime, smProfile.scheduledDinoWipeDays)
      : null;
    smDinoWipeCountdownEl.textContent = 'Next dinowipe in: ' + (dinoWipeNext ? formatCountdown(dinoWipeNext.getTime() - now.getTime()) : '--:--:--:--');
  }

  setInterval(function () {
    if (activeView === 'servermanagement') updateSmCountdowns();
  }, 1000);

  function buildDayCheckboxes(container, days, onChange) {
    container.innerHTML = '';
    DAY_LABELS.forEach(function (label, index) {
      var wrapper = document.createElement('label');
      wrapper.className = 'checkbox';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = days.indexOf(index) !== -1;
      input.addEventListener('change', function () { onChange(index, input.checked); });
      wrapper.appendChild(input);
      wrapper.appendChild(document.createTextNode(label));
      container.appendChild(wrapper);
    });
  }

  function showSmError(message) {
    smErrorEl.textContent = message || '';
    smErrorEl.style.display = message ? '' : 'none';
  }

  function saveSmField(field, value) {
    if (!currentId || !smProfile) return;
    var id = currentId;
    var body = {};
    body[field] = value;
    fetch('/api/servers/' + encodeURIComponent(id) + '/servermanagement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (r) { return r.json(); })
      .then(function (result) {
        if (!result.ok) { showSmError(result.error || 'Save failed'); return; }
        if (id !== currentId) return;
        smProfile = result.profile;
        renderServerManagementForm();
      })
      .catch(function () { showSmError('Request failed'); });
  }

  function renderServerManagementForm() {
    var p = smProfile;
    smStartOnLaunch.checked = !!p.startOnManagerLaunch;
    smCrashWatch.checked = !!p.crashWatchEnabled;
    smZombieDetection.checked = !!p.zombieDetectionEnabled;
    smZombieTimeout.value = p.zombieDetectionTimeoutMinutes;
    smZombieTimeout.disabled = !p.zombieDetectionEnabled;
    smZombieAutoRestart.checked = !!p.zombieDetectionAutoRestart;
    smZombieAutoRestart.disabled = !p.zombieDetectionEnabled;
    smArchiveSize.value = p.clusterLogArchiveMaxSizeMB;
    smRestartEnabled.checked = !!p.scheduledRestartEnabled;
    smRestartTime.value = p.scheduledRestartTime || '00:00';
    smRestartTime.disabled = !p.scheduledRestartEnabled;
    smRestartUpdateAfter.checked = !!p.scheduledRestartUpdateAfter;
    smRestartUpdateAfter.disabled = !p.scheduledRestartEnabled;
    smRestartStartAfter.checked = !!p.scheduledRestartStartAfter;
    smRestartStartAfter.disabled = !p.scheduledRestartEnabled;
    buildDayCheckboxes(smRestartDaysEl, p.scheduledRestartDays || [], function (day, checked) {
      var days = (p.scheduledRestartDays || []).slice();
      var idx = days.indexOf(day);
      if (checked && idx === -1) days.push(day);
      if (!checked && idx !== -1) days.splice(idx, 1);
      days.sort(function (a, b) { return a - b; });
      saveSmField('scheduledRestartDays', days);
    });
    smDinoWipeEnabled.checked = !!p.scheduledDinoWipeEnabled;
    smDinoWipeTime.value = p.scheduledDinoWipeTime || '00:00';
    smDinoWipeTime.disabled = !p.scheduledDinoWipeEnabled;
    buildDayCheckboxes(smDinoWipeDaysEl, p.scheduledDinoWipeDays || [], function (day, checked) {
      var days = (p.scheduledDinoWipeDays || []).slice();
      var idx = days.indexOf(day);
      if (checked && idx === -1) days.push(day);
      if (!checked && idx !== -1) days.splice(idx, 1);
      days.sort(function (a, b) { return a - b; });
      saveSmField('scheduledDinoWipeDays', days);
    });
    updateSmCountdowns();
  }

  function loadServerManagementView() {
    var id = currentId;
    if (!id) {
      smNoServerEl.style.display = '';
      smContentEl.classList.remove('active');
      return;
    }
    showSmError('');
    smNoServerEl.style.display = 'none';
    smContentEl.classList.add('active');
    fetch('/api/servers/' + encodeURIComponent(id) + '/servermanagement')
      .then(function (r) { return r.json(); })
      .then(function (profile) {
        if (id !== currentId) return;
        smProfile = profile;
        renderServerManagementForm();
      });
  }

  smStartOnLaunch.addEventListener('change', function () { saveSmField('startOnManagerLaunch', smStartOnLaunch.checked); });
  smCrashWatch.addEventListener('change', function () { saveSmField('crashWatchEnabled', smCrashWatch.checked); });
  smZombieDetection.addEventListener('change', function () { saveSmField('zombieDetectionEnabled', smZombieDetection.checked); });
  smZombieTimeout.addEventListener('change', function () { saveSmField('zombieDetectionTimeoutMinutes', Number(smZombieTimeout.value)); });
  smZombieAutoRestart.addEventListener('change', function () { saveSmField('zombieDetectionAutoRestart', smZombieAutoRestart.checked); });
  smArchiveSize.addEventListener('change', function () { saveSmField('clusterLogArchiveMaxSizeMB', Math.min(100, Math.max(1, Number(smArchiveSize.value)))); });
  smRestartEnabled.addEventListener('change', function () { saveSmField('scheduledRestartEnabled', smRestartEnabled.checked); });
  smRestartTime.addEventListener('change', function () { saveSmField('scheduledRestartTime', smRestartTime.value); });
  smRestartUpdateAfter.addEventListener('change', function () { saveSmField('scheduledRestartUpdateAfter', smRestartUpdateAfter.checked); });
  smRestartStartAfter.addEventListener('change', function () { saveSmField('scheduledRestartStartAfter', smRestartStartAfter.checked); });
  smDinoWipeEnabled.addEventListener('change', function () { saveSmField('scheduledDinoWipeEnabled', smDinoWipeEnabled.checked); });
  smDinoWipeTime.addEventListener('change', function () { saveSmField('scheduledDinoWipeTime', smDinoWipeTime.value); });

  // -- Settings ---------------------------------------------------------------------------
  var settingsServerSelectEl = document.getElementById('settings-server-select');
  var settingsNoServerEl = document.getElementById('settings-no-server');
  var settingsContentEl = document.getElementById('settings-content');
  var settingsStatusEl = document.getElementById('settings-status');
  var settingsErrorEl = document.getElementById('settings-error');
  var settingsName = document.getElementById('settings-name');
  var settingsInstallDir = document.getElementById('settings-installdir');
  var settingsGamePort = document.getElementById('settings-gameport');
  var settingsRconPort = document.getElementById('settings-rconport');
  var settingsPlatform = document.getElementById('settings-platform');
  var settingsMaxPlayers = document.getElementById('settings-maxplayers');
  var settingsMap = document.getElementById('settings-map');
  var settingsModdedMapId = document.getElementById('settings-moddedmapid');
  var settingsModdedMapEnabled = document.getElementById('settings-moddedmapenabled');
  var settingsBetaEnabled = document.getElementById('settings-betaenabled');
  var settingsBetaName = document.getElementById('settings-betaname');
  var settingsCulture = document.getElementById('settings-culture');
  var settingsBattlEye = document.getElementById('settings-battleye');
  var settingsTribeLog = document.getElementById('settings-tribelog');
  var settingsRespawnDinos = document.getElementById('settings-respawndinos');
  var settingsNoSound = document.getElementById('settings-nosound');
  var settingsGroup = document.getElementById('settings-group');
  var settingsExtraArgs = document.getElementById('settings-extraargs');
  var settingsClusterEnabled = document.getElementById('settings-clusterenabled');
  var settingsClusterId = document.getElementById('settings-clusterid');
  var settingsClusterDir = document.getElementById('settings-clusterdir');
  var settingsNoTransferFiltering = document.getElementById('settings-notransferfiltering');
  var settingsExternalIp = document.getElementById('settings-externalip');
  var settingsProfile = null;
  var settingsMapsCache = { maps: [], customMaps: [] };

  function showSettingsError(message) {
    settingsErrorEl.textContent = message || '';
    settingsErrorEl.style.display = message ? '' : 'none';
  }

  function showSettingsStatus(message) {
    settingsStatusEl.textContent = message || '';
    settingsStatusEl.style.display = message ? '' : 'none';
    if (message) setTimeout(function () { showSettingsStatus(''); }, 2000);
  }

  function populateSettingsMapOptions() {
    var current = settingsProfile ? settingsProfile.map : '';
    settingsMap.innerHTML = '';
    var known = settingsMapsCache.maps.concat(settingsMapsCache.customMaps);
    if (current && !known.some(function (m) { return m.id === current; })) {
      var currentOpt = document.createElement('option');
      currentOpt.value = current;
      currentOpt.textContent = current;
      settingsMap.appendChild(currentOpt);
    }
    var officialGroup = document.createElement('optgroup');
    officialGroup.label = 'Official';
    settingsMapsCache.maps.forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.displayName;
      officialGroup.appendChild(opt);
    });
    settingsMap.appendChild(officialGroup);
    var customGroup = document.createElement('optgroup');
    customGroup.label = 'Custom';
    settingsMapsCache.customMaps.forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.displayName;
      customGroup.appendChild(opt);
    });
    settingsMap.appendChild(customGroup);
    settingsMap.value = current;
  }

  function renderSettingsForm() {
    var p = settingsProfile;
    settingsName.value = p.name;
    settingsInstallDir.value = p.installDir;
    settingsGamePort.value = p.gamePort;
    settingsRconPort.value = p.rconPort;
    settingsPlatform.value = p.serverPlatform;
    settingsMaxPlayers.value = p.maxPlayers;
    populateSettingsMapOptions();
    settingsModdedMapId.value = p.moddedMapId || '';
    settingsModdedMapId.disabled = !p.moddedMapEnabled;
    settingsModdedMapEnabled.checked = !!p.moddedMapEnabled;
    settingsBetaEnabled.checked = !!p.steamBetaEnabled;
    settingsBetaName.value = p.steamBetaName || '';
    settingsBetaName.disabled = !p.steamBetaEnabled;
    settingsCulture.value = p.cultureSettings;
    settingsBattlEye.checked = !!p.disableBattlEye;
    settingsTribeLog.checked = !!p.rconTribeLog;
    settingsRespawnDinos.checked = !!p.forceRespawnDinos;
    settingsNoSound.checked = !!p.noSound;
    settingsGroup.value = p.group;
    settingsExtraArgs.value = p.extraArgs;
    settingsClusterEnabled.checked = !!p.clusterEnabled;
    settingsClusterId.value = p.clusterId;
    settingsClusterId.disabled = !p.clusterEnabled;
    settingsClusterDir.value = p.clusterDirOverride;
    settingsClusterDir.disabled = !p.clusterEnabled;
    settingsNoTransferFiltering.checked = !!p.noTransferFromFiltering;
    settingsNoTransferFiltering.disabled = !p.clusterEnabled;
    settingsExternalIp.value = p.externalIp;
    settingsExternalIp.disabled = !p.clusterEnabled;
  }

  function saveSettingsField(field, value) {
    if (!currentId || !settingsProfile) return;
    var id = currentId;
    var body = {};
    body[field] = value;
    showSettingsError('');
    fetch('/api/servers/' + encodeURIComponent(id) + '/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (r) { return r.json(); })
      .then(function (result) {
        if (!result.ok) { showSettingsError(result.error || 'Save failed'); return; }
        if (id !== currentId) return;
        settingsProfile = result.profile;
        renderSettingsForm();
        showSettingsStatus('Saved');
      })
      .catch(function () { showSettingsError('Request failed'); });
  }

  function loadSettingsMaps() {
    fetch('/api/maps').then(function (r) { return r.json(); }).then(function (data) {
      settingsMapsCache = data;
      if (settingsProfile) populateSettingsMapOptions();
    });
  }

  function loadSettingsView() {
    var id = currentId;
    if (!id) {
      settingsNoServerEl.style.display = '';
      settingsContentEl.classList.remove('active');
      return;
    }
    showSettingsError('');
    settingsNoServerEl.style.display = 'none';
    settingsContentEl.classList.add('active');
    loadSettingsMaps();
    fetch('/api/servers/' + encodeURIComponent(id) + '/profile')
      .then(function (r) { return r.json(); })
      .then(function (profile) {
        if (id !== currentId) return;
        settingsProfile = profile;
        renderSettingsForm();
      });
  }

  settingsName.addEventListener('change', function () { saveSettingsField('name', settingsName.value); });
  settingsInstallDir.addEventListener('change', function () { saveSettingsField('installDir', settingsInstallDir.value); });
  settingsGamePort.addEventListener('change', function () { saveSettingsField('gamePort', Number(settingsGamePort.value)); });
  settingsRconPort.addEventListener('change', function () { saveSettingsField('rconPort', Number(settingsRconPort.value)); });
  settingsPlatform.addEventListener('change', function () { saveSettingsField('serverPlatform', settingsPlatform.value); });
  settingsMaxPlayers.addEventListener('change', function () { saveSettingsField('maxPlayers', Number(settingsMaxPlayers.value)); });
  settingsMap.addEventListener('change', function () { saveSettingsField('map', settingsMap.value); });
  settingsModdedMapId.addEventListener('change', function () { saveSettingsField('moddedMapId', settingsModdedMapId.value); });
  settingsModdedMapEnabled.addEventListener('change', function () { saveSettingsField('moddedMapEnabled', settingsModdedMapEnabled.checked); });
  settingsBetaEnabled.addEventListener('change', function () { saveSettingsField('steamBetaEnabled', settingsBetaEnabled.checked); });
  settingsBetaName.addEventListener('change', function () { saveSettingsField('steamBetaName', settingsBetaName.value); });
  settingsCulture.addEventListener('change', function () { saveSettingsField('cultureSettings', settingsCulture.value); });
  settingsBattlEye.addEventListener('change', function () { saveSettingsField('disableBattlEye', settingsBattlEye.checked); });
  settingsTribeLog.addEventListener('change', function () { saveSettingsField('rconTribeLog', settingsTribeLog.checked); });
  settingsRespawnDinos.addEventListener('change', function () { saveSettingsField('forceRespawnDinos', settingsRespawnDinos.checked); });
  settingsNoSound.addEventListener('change', function () { saveSettingsField('noSound', settingsNoSound.checked); });
  settingsGroup.addEventListener('change', function () { saveSettingsField('group', settingsGroup.value); });
  settingsExtraArgs.addEventListener('change', function () { saveSettingsField('extraArgs', settingsExtraArgs.value); });
  settingsClusterEnabled.addEventListener('change', function () { saveSettingsField('clusterEnabled', settingsClusterEnabled.checked); });
  settingsClusterId.addEventListener('change', function () { saveSettingsField('clusterId', settingsClusterId.value); });
  settingsClusterDir.addEventListener('change', function () { saveSettingsField('clusterDirOverride', settingsClusterDir.value); });
  settingsNoTransferFiltering.addEventListener('change', function () { saveSettingsField('noTransferFromFiltering', settingsNoTransferFiltering.checked); });
  settingsExternalIp.addEventListener('change', function () { saveSettingsField('externalIp', settingsExternalIp.value); });

  var CONSOLE_AUTOSCROLL_KEY = 'ark-dashboard-console-autoscroll';
  var consoleAutoScroll = false;
  try { consoleAutoScroll = localStorage.getItem(CONSOLE_AUTOSCROLL_KEY) === '1'; } catch (err) { /* storage unavailable - not fatal */ }

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
      var autoScrollWrapper = document.createElement('label');
      var autoScrollCb = document.createElement('input');
      autoScrollCb.type = 'checkbox';
      autoScrollCb.checked = consoleAutoScroll;
      autoScrollCb.addEventListener('change', function () {
        consoleAutoScroll = autoScrollCb.checked;
        try { localStorage.setItem(CONSOLE_AUTOSCROLL_KEY, consoleAutoScroll ? '1' : '0'); } catch (err) { /* storage unavailable - not fatal */ }
      });
      autoScrollWrapper.appendChild(autoScrollCb);
      autoScrollWrapper.appendChild(document.createTextNode('Auto-scroll'));
      filtersEl.appendChild(autoScrollWrapper);
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
    if (consoleAutoScroll) consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  // Ticks the uptime line once a second between the 5s /api/servers polls, the same "live"
  // feel the desktop Manager's own Analytics tab uptime field has - rebuilding the whole
  // status panel every second just for this would be wasteful, so only this one span is
  // touched by the interval below.
  var uptimeValueEl = null;
  var uptimeStartedAt = null;
  var uptimeRunning = false;

  function formatUptime(ms) {
    var totalSeconds = Math.floor(ms / 1000);
    var seconds = totalSeconds % 60;
    var totalMinutes = Math.floor(totalSeconds / 60);
    var minutes = totalMinutes % 60;
    var totalHours = Math.floor(totalMinutes / 60);
    var hours = totalHours % 24;
    var days = Math.floor(totalHours / 24);
    return days + 'd ' + hours + 'h ' + minutes + 'm ' + seconds + 's';
  }

  setInterval(function () {
    if (uptimeValueEl && uptimeRunning && uptimeStartedAt) {
      uptimeValueEl.textContent = formatUptime(Date.now() - uptimeStartedAt);
    }
  }, 1000);

  function renderStatus(s) {
    statusEl.innerHTML = '';
    if (!s) {
      startBtn.disabled = true; stopBtn.disabled = true; restartBtn.disabled = true; stopUpdateRestartBtn.disabled = true;
      uptimeValueEl = null;
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

    uptimeRunning = s.state === 'running';
    uptimeStartedAt = s.startedAt || null;
    var uptimeLine = document.createElement('div');
    var uptimeStrong = document.createElement('strong');
    uptimeStrong.textContent = 'Uptime: ';
    uptimeValueEl = document.createElement('span');
    uptimeValueEl.textContent = uptimeRunning && uptimeStartedAt ? formatUptime(Date.now() - uptimeStartedAt) : '-';
    uptimeLine.appendChild(uptimeStrong);
    uptimeLine.appendChild(uptimeValueEl);
    lines.appendChild(uptimeLine);

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

  var SERVER_SCOPED_VIEWS = ['console', 'analytics', 'backup', 'settings', 'mods', 'mapmanagement', 'servermanagement', 'updatelog'];

  // Every per-server view carries its own server picker in its header (top-right, via the
  // .server-picker CSS class) - not just the Console view's original one - so switching
  // servers never requires going back to Cluster Dashboard first. All 8 always show the same
  // options and stay in sync with each other and with currentId.
  var SERVER_PICKERS = [
    select,
    analyticsServerSelectEl,
    settingsServerSelectEl,
    modsServerSelectEl,
    backupServerSelectEl,
    mapmanagementServerSelectEl,
    smServerSelectEl,
    updatelogServerSelectEl
  ];

  // servers arrives already ordered ungrouped-first-then-alphabetical-by-group (server-side
  // sortProfilesForDisplay), so a run of consecutive same-group entries can just be wrapped in
  // one optgroup as it's encountered - same idea as populateSettingsMapOptions' Official/Custom
  // optgroups, but grouped by each server's own Dashboard group instead of a fixed pair.
  function populateServerPickers(servers) {
    SERVER_PICKERS.forEach(function (picker) {
      picker.innerHTML = '';
      var openGroupName = null;
      var openGroupEl = null;
      servers.forEach(function (s) {
        var group = s.group || '';
        var opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        if (!group) {
          openGroupName = null;
          openGroupEl = null;
          picker.appendChild(opt);
          return;
        }
        if (group !== openGroupName) {
          openGroupName = group;
          openGroupEl = document.createElement('optgroup');
          openGroupEl.label = group;
          picker.appendChild(openGroupEl);
        }
        openGroupEl.appendChild(opt);
      });
    });
  }

  function syncServerPickers() {
    if (!currentId) return;
    SERVER_PICKERS.forEach(function (picker) { picker.value = currentId; });
  }

  SERVER_PICKERS.forEach(function (picker) {
    picker.addEventListener('change', function () { selectServer(picker.value); });
  });

  function selectServer(id) {
    if (id === currentId) return;
    currentId = id;
    syncServerPickers();
    if (id) revealServerScopedNav();
    backupShowAll = false;
    if (activeView === 'analytics') loadAnalyticsView();
    if (activeView === 'backup') loadBackupView();
    if (activeView === 'settings') loadSettingsView();
    if (activeView === 'mods') loadModsView();
    if (activeView === 'mapmanagement') loadMapManagementView();
    if (activeView === 'servermanagement') loadServerManagementView();
    if (activeView === 'updatelog') loadUpdateLogView();
    consoleEl.innerHTML = '';
    if (es) { es.close(); es = null; }
    loadPlayers();
    if (!id) return;
    fetch('/api/servers/' + encodeURIComponent(id) + '/events')
      .then(function (r) { return r.json(); })
      .then(function (events) {
        events.forEach(addEvent);
        // Opening a server's console should land on the latest activity, not the oldest -
        // regardless of the Auto-scroll setting, which only governs whether it keeps
        // following new events from here on.
        consoleEl.scrollTop = consoleEl.scrollHeight;
      });
    var esUrl = '/api/servers/' + encodeURIComponent(id) + '/events/stream';
    if (accessToken) esUrl += '?token=' + encodeURIComponent(accessToken);
    es = new EventSource(esUrl);
    es.onmessage = function (msg) { addEvent(JSON.parse(msg.data)); };
    es.addEventListener('reset', function () { consoleEl.innerHTML = ''; });
  }

  function loadServers() {
    fetch('/api/servers').then(function (r) { return r.json(); }).then(function (servers) {
      latestServers = servers;
      checkClusterStateTransitions(servers);
      populateServerPickers(servers);
      // A server that was selected can vanish out from under us (profile deleted, or
      // filtered out by Hidden) - treat that the same as never having selected one. Unlike
      // before, this never auto-picks a replacement: Dashboard/Backup/the admin tabs only
      // ever get a server through an explicit click (see revealServerScopedNav), never a
      // silent default - so losing the selection just falls back to Cluster Dashboard.
      if (currentId && !servers.some(function (s) { return s.id === currentId; })) {
        currentId = null;
        if (SERVER_SCOPED_VIEWS.indexOf(activeView) !== -1) selectView('cluster');
      }
      syncServerPickers();
      renderStatus(servers.find(function (s) { return s.id === currentId; }));
      renderAnalyticsStatus();
      renderClusterCards(servers);
      if (activeView === 'dashboard') renderDashboardCards(servers);
      refreshClusterConsoleServers();
    });
  }

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
}
</script>
</body>
</html>
`
