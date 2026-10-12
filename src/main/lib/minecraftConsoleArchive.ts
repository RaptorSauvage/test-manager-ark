import fs from 'node:fs'
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
 */
export function appendConsoleLineToArchive(profileId: string, line: MinecraftConsoleLine, maxBytes = MAX_ARCHIVE_BYTES): void {
  try {
    const archivePath = getMinecraftConsoleArchivePath(profileId)
    fs.mkdirSync(path.dirname(archivePath), { recursive: true })
    fs.appendFileSync(archivePath, JSON.stringify(line) + '\n')

    const { size } = fs.statSync(archivePath)
    if (size <= maxBytes) return

    const buffer = Buffer.alloc(maxBytes)
    const fd = fs.openSync(archivePath, 'r')
    try {
      fs.readSync(fd, buffer, 0, maxBytes, size - maxBytes)
    } finally {
      fs.closeSync(fd)
    }
    let text = buffer.toString('utf-8')
    const firstNewline = text.indexOf('\n')
    if (firstNewline >= 0) text = text.slice(firstNewline + 1)
    fs.writeFileSync(archivePath, text)
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
export function readMinecraftConsoleArchive(profileId: string, maxBytes = ARCHIVE_READ_BYTES): MinecraftConsoleLine[] {
  const text = readFileTail(getMinecraftConsoleArchivePath(profileId), maxBytes)
  const lines: MinecraftConsoleLine[] = []
  for (const rawLine of text.split('\n')) {
    const line = parseArchiveLine(rawLine)
    if (line) lines.push(line)
  }
  return lines
}
