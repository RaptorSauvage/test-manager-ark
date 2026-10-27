import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import type { MinecraftConsoleLine } from '@shared/minecraft'
import { getDataDir } from './dataDir'
import { readFileTail } from './logEvents'

/** Same JSON-Lines, size-capped-rotation archive pattern as clusterLogArchive.ts, adapted
 *  for Minecraft's raw console text instead of ARK's parsed log events - see that file's own
 *  comments for the full reasoning behind the rolling-window trim. Unlike ARK's per-profile
 *  clusterLogArchiveMaxSizeMB setting, this cap is fixed: Minecraft's own console is far less
 *  chatty than ShooterGame.log, so there's no real need to make it configurable. */
const MAX_ARCHIVE_BYTES = 2_000_000
const ARCHIVE_READ_BYTES = 2_000_000

export function getMinecraftConsoleArchivePath(profileId: string): string {
  return path.join(getDataDir(), 'logs', 'minecraft-console', `${profileId}.jsonl`)
}

function parseArchiveLine(line: string): MinecraftConsoleLine | null {
  if (!line.trim()) return null
  try {
    const parsed: unknown = JSON.parse(line)
    if (parsed && typeof parsed === 'object' && 'text' in parsed && 'ts' in parsed) {
      return parsed as MinecraftConsoleLine
    }
    return null
  } catch {
    return null
  }
}

/** Writes a whole batch of lines in a single append, then trims the archive back down to
 *  maxBytes (dropping the oldest content) if it's grown past that - a rolling window, not
 *  unbounded growth. The trim only does a bounded read+rewrite, and only when this batch
 *  actually crosses the cap. Shared by appendConsoleLineToArchive (a batch of exactly one,
 *  for a caller that wants a single line written and awaitable right away) and
 *  queueConsoleLineForArchive's own debounced flush (a batch of however many lines arrived
 *  in one flush window) below. */
async function writeLinesToArchive(profileId: string, lines: MinecraftConsoleLine[], maxBytes: number): Promise<void> {
  if (lines.length === 0) return
  try {
    const archivePath = getMinecraftConsoleArchivePath(profileId)
    await fsPromises.mkdir(path.dirname(archivePath), { recursive: true })
    await fsPromises.appendFile(archivePath, lines.map((line) => JSON.stringify(line)).join('\n') + '\n')

    const { size } = await fsPromises.stat(archivePath)
    if (size <= maxBytes) return

    const buffer = Buffer.alloc(maxBytes)
    const handle = await fsPromises.open(archivePath, 'r')
    try {
      await handle.read(buffer, 0, maxBytes, size - maxBytes)
    } finally {
      await handle.close()
    }
    let text = buffer.toString('utf-8')
    const firstNewline = text.indexOf('\n')
    if (firstNewline >= 0) text = text.slice(firstNewline + 1)
    await fsPromises.writeFile(archivePath, text)
  } catch (err) {
    // Best-effort persistence, called on every single console line while a server is
    // running - a disk-level failure here (full disk, locked file, antivirus, ...) must
    // never throw back out and interrupt the console pipe, same reasoning as
    // clusterLogArchive.ts's own appendEventsToArchive.
    console.error(`Failed to append to the Minecraft console archive for ${profileId}:`, (err as Error).message)
  }
}

/** Appends one console line to profileId's permanent archive file right away - see
 *  writeLinesToArchive for the actual write/trim logic. Kept as its own single-line,
 *  immediately-awaitable entry point for a caller that wants exactly that (a test, or any
 *  future one-off caller) - minecraftProcess.ts's own per-line hot path uses
 *  queueConsoleLineForArchive below instead, not this. */
export async function appendConsoleLineToArchive(
  profileId: string,
  line: MinecraftConsoleLine,
  maxBytes = MAX_ARCHIVE_BYTES
): Promise<void> {
  return writeLinesToArchive(profileId, [line], maxBytes)
}

/** How long queueConsoleLineForArchive waits, after the first line queued since its last
 *  flush, before actually writing - batches whatever arrives in that window into one append
 *  instead of one fs round-trip per line. Short enough that a line is never meaningfully
 *  stale by the time it reaches disk/the archive. */
const QUEUE_FLUSH_INTERVAL_MS = 250

interface PendingArchiveBatch {
  lines: MinecraftConsoleLine[]
  maxBytes: number
  timer: NodeJS.Timeout
}

const pendingBatches = new Map<string, PendingArchiveBatch>()

function flushPendingBatch(profileId: string): void {
  const batch = pendingBatches.get(profileId)
  if (!batch) return
  pendingBatches.delete(profileId)
  void writeLinesToArchive(profileId, batch.lines, batch.maxBytes)
}

/**
 * Queues a console line to be written to profileId's archive on the next flush, instead of
 * writing it immediately - this is what minecraftProcess.ts's onStdoutLine/onStderrLine
 * actually call for every line a server prints. A real report tied an escalating, several-
 * minute Manager freeze specifically to a big modpack's own startup (hundreds of mods'
 * loading messages, all printed within seconds of Start) to appendConsoleLineToArchive's
 * previous one-fs-round-trip-per-line design: even with every individual call async (not
 * fs.*Sync), firing hundreds or thousands of independent mkdir+appendFile+stat calls within
 * the same burst - none of them awaited by the caller - was enough to flood the Electron
 * process's I/O (CPU stayed low throughout the freeze, confirming it was an I/O queue
 * backing up rather than anything CPU-bound) badly enough to stall the Manager's own window
 * for tens of seconds at a stretch, repeatedly, for as long as that burst of startup logging
 * kept going. Batching every line queued within the same QUEUE_FLUSH_INTERVAL_MS window into
 * a single append call cuts that same burst down to a handful of actual fs round-trips
 * instead of thousands.
 */
export function queueConsoleLineForArchive(profileId: string, line: MinecraftConsoleLine, maxBytes = MAX_ARCHIVE_BYTES): void {
  let batch = pendingBatches.get(profileId)
  if (!batch) {
    const timer = setTimeout(() => flushPendingBatch(profileId), QUEUE_FLUSH_INTERVAL_MS)
    timer.unref()
    batch = { lines: [], maxBytes, timer }
    pendingBatches.set(profileId, batch)
  }
  batch.lines.push(line)
}

/** Writes out profileId's pending queued lines (see queueConsoleLineForArchive) right away
 *  instead of waiting for the next scheduled flush - called once a server actually stops, so
 *  its last few lines land in the archive promptly rather than sitting queued for up to
 *  QUEUE_FLUSH_INTERVAL_MS after nothing is going to add to them anyway. */
export function flushQueuedConsoleLines(profileId: string): void {
  const batch = pendingBatches.get(profileId)
  if (!batch) return
  clearTimeout(batch.timer)
  flushPendingBatch(profileId)
}

/** Reads this profile's persistent console archive - survives both a Manager restart and
 *  (since nothing clears this file on a fresh start - see minecraftProcess.ts's startServer)
 *  the Minecraft server's own restarts too. */
export async function readMinecraftConsoleArchive(
  profileId: string,
  maxBytes = ARCHIVE_READ_BYTES
): Promise<MinecraftConsoleLine[]> {
  const text = await readFileTail(getMinecraftConsoleArchivePath(profileId), maxBytes)
  const lines: MinecraftConsoleLine[] = []
  for (const rawLine of text.split('\n')) {
    const line = parseArchiveLine(rawLine)
    if (line) lines.push(line)
  }
  return lines
}
