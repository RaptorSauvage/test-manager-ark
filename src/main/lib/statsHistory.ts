import fs from 'node:fs'
import path from 'node:path'
import type { StatSample } from '@shared/types'
import { getDataDir } from './dataDir'
import { getSettings } from '../store'

interface StoredStatSample extends StatSample {
  profileId: string
}

function getStatsHistoryPath(): string {
  return path.join(getDataDir(), 'logs', 'stats-history.jsonl')
}

/**
 * In-memory mirror of the on-disk file, once loaded - every read (a Cluster Dashboard or
 * Analytics tab chart polls every 5s while open) used to re-read and re-parse the *entire*
 * file from scratch, every time, which for a file that can grow up to
 * AppSettings.statsHistoryMaxSizeMB (1GB by default) meant a multi-second synchronous,
 * main-process-blocking stall - repeating on every single poll for as long as any stats
 * view stayed open, freezing the whole app's UI each time (IPC, window events, everything
 * else share this same thread). `null` means "not loaded yet" (distinct from `[]`, an
 * empty-but-loaded file) - the first read after app start still pays that one-time parse
 * cost, but recordStatSample keeps this in sync incrementally from then on, so every
 * subsequent read is an in-memory slice instead of a fresh disk read.
 */
let cachedSamples: StoredStatSample[] | null = null

/** Test-only escape hatch - a test that writes directly to the stats-history file on disk
 *  (bypassing recordStatSample, which is the only thing that otherwise keeps the cache
 *  in sync) needs this to make readAllSamples see it instead of a stale in-memory copy
 *  left over from an earlier test in the same file. Never called from production code. */
export function __resetStatsHistoryCacheForTests(): void {
  cachedSamples = null
}

/**
 * Appends one sample for `profileId` to the shared, global stats history file, then trims
 * the oldest lines (from any profile) once the file exceeds the configured global size cap
 * (AppSettings.statsHistoryMaxSizeMB, default 1024 = 1GB) - a single shared budget across
 * every server's history rather than a per-server quota, so the oldest data anywhere is
 * what gets dropped first once the limit is hit, the same rolling-window trim already used
 * by clusterLogArchive.ts and managerLog.ts.
 */
export function recordStatSample(profileId: string, sample: StatSample): void {
  const logPath = getStatsHistoryPath()
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  const entry: StoredStatSample = { profileId, ...sample }
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n')
  // Keeps the cache warm without re-reading the file - only meaningful once something has
  // actually loaded it once; if nothing has queried yet there's nothing to keep in sync,
  // and the eventual first read picks up everything written so far straight from disk.
  if (cachedSamples) cachedSamples.push(entry)

  const maxBytes = Math.max(1, getSettings().statsHistoryMaxSizeMB) * 1024 * 1024
  const { size } = fs.statSync(logPath)
  if (size <= maxBytes) return

  const buffer = Buffer.alloc(maxBytes)
  const fd = fs.openSync(logPath, 'r')
  try {
    fs.readSync(fd, buffer, 0, maxBytes, size - maxBytes)
  } finally {
    fs.closeSync(fd)
  }
  let text = buffer.toString('utf-8')
  const firstNewline = text.indexOf('\n')
  if (firstNewline >= 0) text = text.slice(firstNewline + 1)
  fs.writeFileSync(logPath, text)
  // The trim above rewrote the file, dropping whichever oldest lines no longer fit - the
  // cache (if any) no longer matches it. Rather than replaying the same trim in memory,
  // just drop it; the next read reloads fresh from the now-trimmed file. Trimming only ever
  // happens once the file is already at its size cap, so this full reload is rare.
  cachedSamples = null
}

/** Callers only ever .filter()/.map() this into a new array, never mutate it in place, so
 *  handing back the cached array by reference (once loaded) is safe. */
function readAllSamples(): StoredStatSample[] {
  if (cachedSamples) return cachedSamples

  const logPath = getStatsHistoryPath()
  if (!fs.existsSync(logPath)) {
    cachedSamples = []
    return cachedSamples
  }
  const samples: StoredStatSample[] = []
  for (const line of fs.readFileSync(logPath, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (parsed && typeof parsed === 'object' && 'profileId' in parsed && 'time' in parsed) {
        samples.push(parsed as StoredStatSample)
      }
    } catch {
      // Skip a corrupt/truncated line rather than losing the whole history to it.
    }
  }
  cachedSamples = samples
  return samples
}

interface Bucket {
  cpuSum: number
  memSum: number
  playersSum: number
  count: number
  lastTime: number
}

function bucketizeOne(samples: StatSample[], start: number, bucketWidth: number): Map<number, Bucket> {
  const buckets = new Map<number, Bucket>()
  for (const s of samples) {
    const idx = Math.floor((s.time - start) / bucketWidth)
    const b = buckets.get(idx)
    if (b) {
      b.cpuSum += s.cpu
      b.memSum += s.memoryMB
      b.playersSum += s.players
      b.count += 1
      b.lastTime = Math.max(b.lastTime, s.time)
    } else {
      buckets.set(idx, { cpuSum: s.cpu, memSum: s.memoryMB, playersSum: s.players, count: 1, lastTime: s.time })
    }
  }
  return buckets
}

function bucketAverage(b: Bucket): StatSample {
  return {
    time: b.lastTime,
    cpu: Math.round((b.cpuSum / b.count) * 10) / 10,
    memoryMB: Math.round(b.memSum / b.count),
    players: Math.round(b.playersSum / b.count)
  }
}

/** `Math.min(...samples.map(s => s.time))` looks equivalent but spreads every element as
 *  its own function argument - past roughly 65k-130k samples (engine-dependent) that throws
 *  "Maximum call stack size exceeded" instead of returning a value. A profile with stats
 *  enabled records one sample roughly every 5s, so a single busy day already produces on the
 *  order of 17,000 samples per profile; a modest cluster comfortably blows past the spread
 *  limit within days once "All" (sinceMs === null) is queried, which is exactly when this
 *  runs - every other time scale supplies a concrete sinceMs and skips it entirely. A plain
 *  loop has no such limit regardless of how large `samples` gets. */
function earliestTime(samples: ReadonlyArray<{ time: number }>): number {
  let min = Infinity
  for (const s of samples) {
    if (s.time < min) min = s.time
  }
  return min
}

/** Bucket width so a query spanning any amount of history still returns at most `maxPoints`
 *  points - a chart doesn't benefit from more points than it has pixels for, and returning
 *  every raw ~5s sample over weeks of "All" history would be slow to transfer and render for
 *  no visual benefit. Floored at 1s so a very short/empty window never produces a
 *  zero-width bucket. The `+ 1` before dividing guards the exact-boundary case - without it,
 *  a sample landing precisely on `now` would floor into bucket index `maxPoints` itself
 *  (one past the last valid index), yielding maxPoints + 1 buckets instead of the promised
 *  maxPoints. */
function computeBucketWidth(start: number, now: number, maxPoints: number): number {
  return Math.max(1000, Math.ceil((now - start + 1) / Math.max(1, maxPoints)))
}

/** Reads one profile's CPU/RAM/player history since `sinceMs` (or since its earliest
 *  recorded sample, if `sinceMs` is null - the "All" time scale), downsampled to at most
 *  `maxPoints` points. `now` defaults to the real current time - only ever overridden by
 *  tests, so bucket width math doesn't depend on wall-clock timing during a test run. */
export function readStatsHistory(
  profileId: string,
  sinceMs: number | null,
  maxPoints = 500,
  now = Date.now()
): StatSample[] {
  const filtered = readAllSamples()
    .filter((s) => s.profileId === profileId && (sinceMs === null || s.time >= sinceMs))
    .map(({ time, cpu, memoryMB, players }) => ({ time, cpu, memoryMB, players }))
  if (filtered.length === 0) return []

  const start = sinceMs ?? earliestTime(filtered)
  const bucketWidth = computeBucketWidth(start, now, maxPoints)
  return Array.from(bucketizeOne(filtered, start, bucketWidth).entries())
    .sort(([a], [b]) => a - b)
    .map(([, b]) => bucketAverage(b))
}

/**
 * Shared by readClusterStatsHistory and readClusterStatsHistoryForGroups - everything past
 * "read the file" (parsing every line of stats-history.jsonl is the expensive part, and by
 * far the only part worth sharing across a batch of groups queried together).
 */
function combineClusterHistory(
  allSamples: StoredStatSample[],
  profileIds: string[],
  sinceMs: number | null,
  maxPoints: number,
  now: number
): StatSample[] {
  const idSet = new Set(profileIds)
  const filtered = allSamples
    .filter((s) => idSet.has(s.profileId) && (sinceMs === null || s.time >= sinceMs))
    .map((s) => ({ profileId: s.profileId, time: s.time, cpu: s.cpu, memoryMB: s.memoryMB, players: s.players }))
  if (filtered.length === 0) return []

  const start = sinceMs ?? earliestTime(filtered)
  const bucketWidth = computeBucketWidth(start, now, maxPoints)

  const perProfile = new Map<string, StatSample[]>()
  for (const s of filtered) {
    const arr = perProfile.get(s.profileId) ?? []
    arr.push({ time: s.time, cpu: s.cpu, memoryMB: s.memoryMB, players: s.players })
    perProfile.set(s.profileId, arr)
  }

  const combined = new Map<
    number,
    { cpuSum: number; memSum: number; playersSum: number; lastTime: number; profileCount: number }
  >()
  for (const samples of perProfile.values()) {
    for (const [idx, b] of bucketizeOne(samples, start, bucketWidth)) {
      const avg = bucketAverage(b)
      const existing = combined.get(idx)
      if (existing) {
        existing.cpuSum += avg.cpu
        existing.memSum += avg.memoryMB
        existing.playersSum += avg.players
        existing.lastTime = Math.max(existing.lastTime, avg.time)
        existing.profileCount += 1
      } else {
        combined.set(idx, {
          cpuSum: avg.cpu,
          memSum: avg.memoryMB,
          playersSum: avg.players,
          lastTime: avg.time,
          profileCount: 1
        })
      }
    }
  }

  const sortedEntries = Array.from(combined.entries()).sort(([a], [b]) => a - b)

  // Each profile's own stats-recording tick fires on its own independent timer (see
  // monitor.ts), so by the moment this is read, some still-running profiles can easily not
  // have landed a sample in the newest bucket yet even though the bucket right before it
  // already has contributions from all of them (it had a full bucketWidth to settle before
  // anyone read it). Summing the newest bucket as-is would understate the total and show a
  // misleading dip right at the chart's leading edge - drop it once it has fewer
  // contributors than the settled bucket before it, since a fresh read a few seconds later
  // (the client polls this on an interval) will have it filled in properly anyway.
  if (sortedEntries.length >= 2) {
    const last = sortedEntries[sortedEntries.length - 1][1]
    const prev = sortedEntries[sortedEntries.length - 2][1]
    if (last.profileCount < prev.profileCount) sortedEntries.pop()
  }

  return sortedEntries.map(([, c]) => ({
    time: c.lastTime,
    cpu: Math.round(c.cpuSum * 10) / 10,
    memoryMB: Math.round(c.memSum),
    players: Math.round(c.playersSum)
  }))
}

/**
 * Same as readStatsHistory, but for several profiles at once, summed together per time
 * bucket - each profile's own samples are bucketed (and averaged within a bucket)
 * independently first, then the resulting per-profile values are summed per bucket index.
 * This mirrors the live Cluster Dashboard's own "combined CPU/RAM/players across running
 * servers" aggregation, just applied to history instead of a single live snapshot.
 */
export function readClusterStatsHistory(
  profileIds: string[],
  sinceMs: number | null,
  maxPoints = 500,
  now = Date.now()
): StatSample[] {
  return combineClusterHistory(readAllSamples(), profileIds, sinceMs, maxPoints, now)
}

/**
 * Same as readClusterStatsHistory, but for every dashboard group at once, reading and
 * parsing stats-history.jsonl exactly once and reusing that same in-memory data for every
 * group's own combine pass - instead of one full read per group. The Cluster Dashboard
 * queries every group on the same poll tick, and this file can grow up to
 * AppSettings.statsHistoryMaxSizeMB (1GB by default): re-parsing all of it from scratch for
 * each group multiplied that cost by the group count on every single poll, for no benefit
 * over doing it once.
 */
export function readClusterStatsHistoryForGroups(
  groupProfileIds: Record<string, string[]>,
  sinceMs: number | null,
  maxPoints = 500,
  now = Date.now()
): Record<string, StatSample[]> {
  const allSamples = readAllSamples()
  const result: Record<string, StatSample[]> = {}
  for (const [group, profileIds] of Object.entries(groupProfileIds)) {
    result[group] = combineClusterHistory(allSamples, profileIds, sinceMs, maxPoints, now)
  }
  return result
}
