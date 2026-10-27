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

/**
 * Appends one console line to profileId's permanent archive file, then trims it back down to
 * maxBytes (dropping the oldest content) if it's grown past that - a rolling window, not
 * unbounded growth. The trim only does a bounded read+rewrite, and only on the occasional
 * append that actually crosses the cap.
 *
 * Async (fs.promises), not fs.*Sync - this runs on every single console line a server ever
 * prints, from inside the same synchronous loop that splits a single stdout chunk into
 * individual lines (minecraftProcess.ts's makeLineSplitter). A burst of many lines at once -
 * exactly what a server's own shutdown sequence tends to print (save messages, every
 * player's own disconnect, plugins disabling one by one) - used to mean that many
 * synchronous disk writes back to back on the Electron main process, blocking it for the
 * whole burst. Fire-and-forget (the caller doesn't await this) is fine here: the console
 * pipe itself doesn't depend on the write finishing, same as every other best-effort archive
 * write in this codebase.
 */
export async function appendConsoleLineToArchive(
  profileId: string,
  line: MinecraftConsoleLine,
  maxBytes = MAX_ARCHIVE_BYTES
): Promise<void> {
  try {
    const archivePath = getMinecraftConsoleArchivePath(profileId)
    await fsPromises.mkdir(path.dirname(archivePath), { recursive: true })
    await fsPromises.appendFile(archivePath, JSON.stringify(line) + '\n')

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
