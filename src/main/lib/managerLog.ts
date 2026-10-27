import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import type { ManagerLogEntry } from '@shared/types'
import { getDataDir } from './dataDir'

/** Emits 'log' with the new ManagerLogEntry every time one is recorded, so the Manager Log
 *  view can append live instead of re-fetching/polling the whole file. */
export const managerLogEvents = new EventEmitter()

/** Fixed rolling-window cap - unlike the per-server cluster log archive, this isn't a
 *  per-profile setting; it's Manager-wide activity, expected to accumulate slowly enough
 *  that a single generous fixed size never needs tuning per install. */
const MAX_BYTES = 5 * 1024 * 1024

function getManagerLogPath(): string {
  return path.join(getDataDir(), 'logs', 'manager.jsonl')
}

let sequence = 0

/** A fresh id for a new task instance - pass the same one to every logManagerEvent() call
 *  that belongs to the same task run, so they're grouped together under one header. */
export function newTaskId(prefix: string): string {
  sequence += 1
  return `${prefix}-${Date.now()}-${sequence}`
}

function nowAsLogDateTime(): { date: string; ts: string } {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return {
    date: `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`,
    ts: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  }
}

/** The actual disk work, split out of logManagerEvent so that function can stay synchronous
 *  to call (every one of its ~15 call sites across the app fires it off without awaiting, so
 *  changing its own signature to async would mean touching every one of them) while the
 *  actual I/O - previously fs.*Sync throughout - runs in the background instead of blocking
 *  the entire Electron main process. A real report tied exactly this (nearly every action in
 *  the app - start/stop/kill/update/backup/... - logs through here) to a several-second
 *  freeze on, among other things, starting a Minecraft server, even after the other
 *  known-synchronous calls on that same path had already been fixed. */
async function persistManagerLogEntry(entry: ManagerLogEntry): Promise<void> {
  try {
    const logPath = getManagerLogPath()
    await fsPromises.mkdir(path.dirname(logPath), { recursive: true })
    await fsPromises.appendFile(logPath, JSON.stringify(entry) + '\n')

    const { size } = await fsPromises.stat(logPath)
    if (size > MAX_BYTES) {
      const buffer = Buffer.alloc(MAX_BYTES)
      const handle = await fsPromises.open(logPath, 'r')
      try {
        await handle.read(buffer, 0, MAX_BYTES, size - MAX_BYTES)
      } finally {
        await handle.close()
      }
      let text = buffer.toString('utf-8')
      const firstNewline = text.indexOf('\n')
      if (firstNewline >= 0) text = text.slice(firstNewline + 1)
      await fsPromises.writeFile(logPath, text)
    }
  } catch (err) {
    // Best-effort persistence - a disk-level failure (a full disk, a locked file, antivirus, a
    // dropped network drive, ...) must not break the actual action this is attached to. A real
    // report showed exactly that on Windows (a raw libuv "UNKNOWN: unknown error, write"): an
    // unwritable manager.jsonl turned every single server action into a reported failure, even
    // though the action itself (e.g. stopping the server) had already completed successfully
    // before this ran.
    console.error('Failed to persist a Manager Log entry:', (err as Error).message)
  }
}

/** Returns the pending persist promise - every real call site fires this as a bare statement
 *  and ignores it (fire-and-forget, same as before), but a test that wants to readManagerLog()
 *  right afterward and reliably see this entry needs a way to wait for the write to actually
 *  land first; returning it here is that hook without making every call site `await` it. Same
 *  pattern as clusterLogArchive.ts's handleStatusForClusterLogArchiveNotification. */
export function logManagerEvent(
  taskId: string,
  taskLabel: string,
  message: string,
  level: 'info' | 'error' = 'info'
): Promise<void> {
  sequence += 1
  const entry: ManagerLogEntry = {
    id: `${Date.now()}-${sequence}`,
    ...nowAsLogDateTime(),
    taskId,
    taskLabel,
    message,
    level
  }

  managerLogEvents.emit('log', entry)

  return persistManagerLogEntry(entry)
}

export async function readManagerLog(): Promise<ManagerLogEntry[]> {
  const logPath = getManagerLogPath()
  let raw: string
  try {
    raw = await fsPromises.readFile(logPath, 'utf-8')
  } catch (err) {
    // Covers both "file doesn't exist yet" (nothing logged so far) and a genuine disk-level
    // read failure - same reasoning as persistManagerLogEntry's own write-side fix, a failure
    // here must not crash whatever asked for the log (the Manager Log view's own IPC read).
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Failed to read the Manager Log:', (err as Error).message)
    }
    return []
  }
  const entries: ManagerLogEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (parsed && typeof parsed === 'object' && 'taskId' in parsed && 'message' in parsed) {
        entries.push(parsed as ManagerLogEntry)
      }
    } catch {
      // Skip a corrupt/truncated line rather than losing the whole log to it.
    }
  }
  return entries
}
