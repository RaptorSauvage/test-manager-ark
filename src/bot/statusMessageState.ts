// Persists the ARK/Minecraft status embed's message id across bot restarts - without this,
// statusRefresh.ts's in-memory `statusMessage`/`mcStatusMessage` reset to null every time the
// bot process restarts (which happens on every Settings save, not just a crash/manual
// restart - see discordBot.ts's startDiscordBot, which always stops then re-spawns). The old
// behavior fell back to searching the channel's last 20 messages for one of the bot's own
// embeds, which silently posted a brand new message instead of finding the real one whenever
// that search missed (the status embed scrolled past the last 20 messages, or several old
// candidates from earlier misses confused the `.find()`) - exactly the "spam" a user reported.
// Fetching the exact persisted id instead removes the guessing entirely.
import fs from 'node:fs'
import path from 'node:path'
import { log } from './logging'

let statusMessageId: string | null = null
let mcStatusMessageId: string | null = null
let stateFilePath: string | null = null

interface PersistedStatusMessageState {
  statusMessageId: string | null
  mcStatusMessageId: string | null
}

/** Loads the persisted message ids from `stateDir` - call once, right after loading the
 *  bot's own config, before the first status refresh. Safe to call more than once (e.g. in
 *  tests): each call replaces the in-memory ids with whatever is on disk for the new path. */
export function initStatusMessageState(stateDir: string): void {
  stateFilePath = path.join(stateDir, 'status_messages.json')
  statusMessageId = null
  mcStatusMessageId = null
  try {
    if (!fs.existsSync(stateFilePath)) return
    const raw = JSON.parse(fs.readFileSync(stateFilePath, 'utf-8')) as Partial<PersistedStatusMessageState>
    if (typeof raw.statusMessageId === 'string') statusMessageId = raw.statusMessageId
    if (typeof raw.mcStatusMessageId === 'string') mcStatusMessageId = raw.mcStatusMessageId
  } catch (err) {
    log.warn(`Impossible de lire ${stateFilePath} (${(err as Error).message}) - les messages de statut seront recréés.`)
  }
}

function persist(): void {
  if (!stateFilePath) return
  try {
    fs.mkdirSync(path.dirname(stateFilePath), { recursive: true })
    const data: PersistedStatusMessageState = { statusMessageId, mcStatusMessageId }
    fs.writeFileSync(stateFilePath, JSON.stringify(data), 'utf-8')
  } catch (err) {
    log.error(`Impossible d'écrire ${stateFilePath} : ${(err as Error).message}`)
  }
}

export function getPersistedStatusMessageId(): string | null {
  return statusMessageId
}

export function setPersistedStatusMessageId(id: string | null): void {
  statusMessageId = id
  persist()
}

export function getPersistedMcStatusMessageId(): string | null {
  return mcStatusMessageId
}

export function setPersistedMcStatusMessageId(id: string | null): void {
  mcStatusMessageId = id
  persist()
}
