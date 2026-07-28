import { PLAYER_NAME_OPEN, PLAYER_NAME_CLOSE, type LogEvent } from '@shared/types'

export { PLAYER_NAME_OPEN, PLAYER_NAME_CLOSE }

/** Ported from the standalone Python "ARK Ops Dashboard" the web dashboard's live console
 *  feed replaces - same event categories/regexes. Used only by webDashboard.ts, which
 *  tails each server's log directly per browser connection (see readLogBacklog there). */
const LOG_LINE_RE = /^\[(\d{4}\.\d{2}\.\d{2})-(\d{2})\.(\d{2})\.(\d{2}):\d+\]\[\s*\d+\]\s?(.*)$/
const RICHCOLOR_OPEN_RE = /<RichColor[^>]*>/g
const RICHCOLOR_CLOSE_RE = /<\/>/g
const INNER_TS_RE = /^\d{4}\.\d{2}\.\d{2}_\d{2}\.\d{2}\.\d{2}:\s*/
const JOIN_LEFT_RE = /^(.*?)\s*\[UniqueNetId:\s*(\S+)\s+Platform:[^\]]*\]\s*(joined|left) this ARK!/
const IP_LOOKUP_RE = /IP for incoming account\s+(\S+)\s*-\s*IP\s+(\S+)/
const ADMINCMD_RE = /AdminCmd:\s*(.+?)\s*\(PlayerName:\s*([^,]+),/
const CHAT_MSG_RE = /^(.+?)\s*\((.+?)\):\s*(.+)$/
const MISSION_RE = /^Mission Started:\s*(.+?)\s+by Player:\s*(\S+?)\.?$/
const STARTUP_COMPLETE_RE = /^Server has completed startup and is now advertising for join\.\s*\((.+?)\)\s*$/

interface LogEventCaches {
  ipCache: Map<string, string>
  playerCache: Map<string, string>
}

export function createLogEventCaches(): LogEventCaches {
  return { ipCache: new Map(), playerCache: new Map() }
}

function cleanArkText(raw: string): string {
  return raw.replace(RICHCOLOR_OPEN_RE, '').replace(RICHCOLOR_CLOSE_RE, '').replace(INNER_TS_RE, '').trim()
}

/** Parses one raw ShooterGame.log line into a display-ready LogEvent, or null if it's
 *  either malformed or purely technical engine noise (GC, mod loading, etc). */
export function parseLogLine(rawLine: string, caches: LogEventCaches): LogEvent | null {
  const line = rawLine.replace(/\r?\n$/, '')
  if (!line) return null

  const m = line.match(LOG_LINE_RE)
  if (!m) return null
  const [, , hh, mm, ss, restRaw] = m
  const ts = `${hh}:${mm}:${ss}`
  const rest = cleanArkText(restRaw)
  if (!rest) return null

  const ipm = rest.match(IP_LOOKUP_RE)
  if (ipm) {
    caches.ipCache.set(ipm[1], ipm[2])
    return null
  }

  const jm = rest.match(JOIN_LEFT_RE)
  if (jm) {
    const [, player, accountId, action] = jm
    caches.playerCache.set(accountId, player)
    const playerHl = `${PLAYER_NAME_OPEN}${player}${PLAYER_NAME_CLOSE}`
    if (action === 'joined') {
      const ip = caches.ipCache.get(accountId)
      const ipPart = ip ? `, IP: ${ip}` : ''
      return { label: 'JOIN', cls: 'join', text: `${playerHl} joined the server (ID: ${accountId}${ipPart})`, ts }
    }
    return { label: 'LEFT', cls: 'leave', text: `${playerHl} left the server`, ts }
  }

  const cm = rest.match(CHAT_MSG_RE)
  if (cm) {
    const [, player, , message] = cm
    return { label: 'CHAT', cls: 'chat', text: `${player}: ${message}`, ts }
  }

  if (rest.includes('AdminCmd:')) {
    const acm = rest.match(ADMINCMD_RE)
    if (acm) {
      const [, cmd, player] = acm
      return { label: 'CMD', cls: 'cmd', text: `${cmd.trim()} — ${player.trim()}`, ts }
    }
    return { label: 'CMD', cls: 'cmd', text: rest, ts }
  }

  const mim = rest.match(MISSION_RE)
  if (mim) {
    const [, missionName, accountId] = mim
    const player = caches.playerCache.get(accountId) ?? accountId
    return { label: 'MISSION', cls: 'mission', text: `Mission started: ${missionName} — ${player}`, ts }
  }

  const sm = rest.match(STARTUP_COMPLETE_RE)
  if (sm) {
    return { label: 'READY', cls: 'ready', text: `Server finished startup and is ready for connections (${sm[1]})`, ts }
  }

  if (rest.includes('Frozen by ID')) return null // complements a "froze ..." line just below, avoids a duplicate

  if (/\bfroze\b/.test(rest)) return { label: 'CRYO', cls: 'freeze', text: rest, ts }
  if (rest.includes('Tamed a')) return { label: 'TAME', cls: 'tame', text: rest, ts }
  if (rest.includes('succumbed to the pain') || rest.includes('was killed!') || rest.includes('was killed by')) {
    return { label: 'KILL', cls: 'kill', text: rest, ts }
  }
  if (rest.startsWith('Saving world')) return { label: 'SAVE', cls: 'save', text: 'Automatic save in progress...', ts }
  if (rest.includes('World Save Complete')) return { label: 'SAVE', cls: 'save', text: 'Automatic save complete', ts }
  if (rest.includes('was destroyed!') || (rest.startsWith('Structure ') && rest.includes('destroyed at'))) {
    return { label: 'WARN', cls: 'warn', text: rest, ts }
  }

  return null // everything else (internal engine logging) is filtered
}

/** Parses every line in a chunk of newly-written log content, in order. */
export function parseLogChunk(chunk: string, caches: LogEventCaches): LogEvent[] {
  const events: LogEvent[] = []
  for (const line of chunk.split(/\r?\n/)) {
    const event = parseLogLine(line, caches)
    if (event) events.push(event)
  }
  return events
}
