import fs from 'node:fs'
import path from 'node:path'
import type { ServerProfile, ServerStatus } from '@shared/types'
import { watchLogFile, serverEvents } from './serverProcess'
import { getDataDir } from './dataDir'
import { readLogBacklogFromFile, type DatedLogEvent } from './logEvents'

/** How much of the archive to actually re-read for a backlog request - generous compared
 *  to the live-log backlog's own budget (logEvents.ts's BACKLOG_BYTES), since the whole
 *  point of this file is to span far more than one session. */
const ARCHIVE_READ_BYTES = 2_000_000

export function getClusterLogArchivePath(profileId: string): string {
  return path.join(getDataDir(), 'logs', 'cluster-console', `${profileId}.log`)
}

/**
 * Appends `chunk` to profileId's permanent archive file, then trims it back down to
 * `maxBytes` (dropping the oldest content, keeping the most recent) if it's grown past
 * that - a rolling window rather than letting it grow forever. The trim only does a bounded
 * (maxBytes-sized) read+rewrite, and only on the occasional append that actually crosses the
 * cap, not on every single append.
 */
function appendToArchive(profileId: string, chunk: string, maxBytes: number): void {
  if (!chunk) return
  const archivePath = getClusterLogArchivePath(profileId)
  fs.mkdirSync(path.dirname(archivePath), { recursive: true })
  fs.appendFileSync(archivePath, chunk)

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
  if (firstNewline >= 0) text = text.slice(firstNewline + 1) // drop the truncated first line
  fs.writeFileSync(archivePath, text)
}

/** Reads this profile's persistent archive for the Cluster Data group console's backlog -
 *  unlike readLogBacklog (which reads straight from the current, session-scoped
 *  ShooterGame.log), this survives the server having been restarted since, as long as the
 *  archive watch below was running through that restart. `disabledLabels` is passed through
 *  to the parser the same way readLogBacklog itself takes it. */
export function readClusterLogArchiveBacklog(profileId: string, disabledLabels?: ReadonlySet<string>): DatedLogEvent[] {
  return readLogBacklogFromFile(getClusterLogArchivePath(profileId), ARCHIVE_READ_BYTES, disabledLabels)
}

export function hasClusterLogArchive(profileId: string): boolean {
  return fs.existsSync(getClusterLogArchivePath(profileId))
}

const stopFns = new Map<string, () => void>()

export function stopClusterLogArchiveWatch(profileId: string): void {
  const stop = stopFns.get(profileId)
  if (stop) {
    stop()
    stopFns.delete(profileId)
  }
}

/** Starts continuously appending profile.installDir's log growth to its permanent archive.
 *  Safe to call for an already-running server adopted at app startup, not just one just
 *  spawned by this session. Rotation cap comes from the profile itself
 *  (clusterLogArchiveMaxSizeMB), so a settings change takes effect on the very next append -
 *  no need to restart the watch for that. */
export function startClusterLogArchiveWatch(profile: ServerProfile, intervalMs = 2000): void {
  stopClusterLogArchiveWatch(profile.id)
  stopFns.set(
    profile.id,
    watchLogFile(
      profile.installDir,
      (chunk) => {
        // A rotated (restarted) session's content is exactly what this archive exists to
        // keep - unlike the live event parser elsewhere, there's no per-session cache to
        // reset here, just raw text to keep appending regardless of `rotated`.
        appendToArchive(profile.id, chunk, Math.max(1, profile.clusterLogArchiveMaxSizeMB) * 1024 * 1024)
      },
      intervalMs
    )
  )
}

/** Starts/stops the per-server archive watch alongside the server's own lifecycle - wired
 *  off serverEvents so it self-cleans on a crash, not just an explicit Stop/Kill. Call once
 *  at app startup. */
export function registerClusterLogArchiveWatch(
  lookupProfile: (id: string) => ServerProfile | undefined,
  intervalMs = 2000
): void {
  serverEvents.on('status', (status: ServerStatus) => {
    if (status.state === 'starting') {
      const profile = lookupProfile(status.profileId)
      if (profile) startClusterLogArchiveWatch(profile, intervalMs)
    } else if (status.state === 'stopped' || status.state === 'error') {
      stopClusterLogArchiveWatch(status.profileId)
    }
  })
}
