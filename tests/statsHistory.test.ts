import { describe, expect, it, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { mockDataDir } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('node:os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('node:path')
  return { mockDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'stats-history-datadir-')) }
})
vi.mock('../src/main/lib/dataDir', () => ({ getDataDir: () => mockDataDir }))

const { mockSettings } = vi.hoisted(() => ({ mockSettings: { statsHistoryMaxSizeMB: 1024 } }))
vi.mock('../src/main/store', () => ({ getSettings: () => mockSettings }))

import {
  recordStatSample,
  readStatsHistory,
  readClusterStatsHistory,
  readClusterStatsHistoryForGroups,
  __resetStatsHistoryCacheForTests
} from '../src/main/lib/statsHistory'

function logPath(): string {
  return path.join(mockDataDir, 'logs', 'stats-history.jsonl')
}

describe('statsHistory', () => {
  afterEach(() => {
    fs.rmSync(logPath(), { force: true })
    mockSettings.statsHistoryMaxSizeMB = 1024
    __resetStatsHistoryCacheForTests()
  })

  it('reports no history before anything has ever been recorded', () => {
    expect(readStatsHistory('never-recorded', null)).toEqual([])
  })

  it('records and reads back a single sample for a profile', () => {
    recordStatSample('server-a', { time: 1000, cpu: 10, memoryMB: 500, players: 2 })

    const history = readStatsHistory('server-a', null)
    expect(history).toEqual([{ time: 1000, cpu: 10, memoryMB: 500, players: 2 }])
  })

  it('keeps the in-memory cache in sync with a sample recorded after an earlier read warmed it', () => {
    recordStatSample('server-a', { time: 1000, cpu: 10, memoryMB: 100, players: 1 })
    expect(readStatsHistory('server-a', null, 500, 1000)).toHaveLength(1) // warms the cache

    recordStatSample('server-a', { time: 2000, cpu: 20, memoryMB: 200, players: 2 })
    expect(readStatsHistory('server-a', null, 500, 2000)).toEqual([
      { time: 1000, cpu: 10, memoryMB: 100, players: 1 },
      { time: 2000, cpu: 20, memoryMB: 200, players: 2 }
    ])
  })

  it('reflects a trim even when an earlier read had already warmed the cache beforehand', () => {
    mockSettings.statsHistoryMaxSizeMB = 1
    recordStatSample('server-a', { time: 1, cpu: 1, memoryMB: 1, players: 1 })
    expect(readStatsHistory('server-a', null)).toHaveLength(1) // warms the cache pre-trim

    const filler = 'x'.repeat(2000)
    for (let i = 0; i < 1000; i++) {
      fs.appendFileSync(logPath(), filler + '\n')
      recordStatSample('server-b', { time: 1000 + i, cpu: 1, memoryMB: 1, players: 1 })
    }

    // A cache left stale from the pre-trim read would still have server-a's long-gone
    // sample; the trim must invalidate it so this reflects the file as it is now.
    expect(readStatsHistory('server-a', null)).toEqual([])
    expect(fs.statSync(logPath()).size).toBeLessThanOrEqual(1024 * 1024)
  })

  it('only returns samples belonging to the requested profile', () => {
    recordStatSample('server-a', { time: 1000, cpu: 10, memoryMB: 500, players: 2 })
    recordStatSample('server-b', { time: 1000, cpu: 99, memoryMB: 999, players: 9 })

    expect(readStatsHistory('server-a', null)).toEqual([{ time: 1000, cpu: 10, memoryMB: 500, players: 2 }])
  })

  it('excludes samples before sinceMs', () => {
    recordStatSample('server-a', { time: 1000, cpu: 10, memoryMB: 500, players: 2 })
    recordStatSample('server-a', { time: 5000, cpu: 20, memoryMB: 600, players: 3 })

    expect(readStatsHistory('server-a', 3000)).toEqual([{ time: 5000, cpu: 20, memoryMB: 600, players: 3 }])
  })

  it('downsamples to at most maxPoints, averaging within each bucket', () => {
    for (let i = 0; i < 100; i++) {
      recordStatSample('server-a', { time: i * 1000, cpu: i, memoryMB: i * 10, players: 1 })
    }

    // now = the last sample's own time, so the [0, 99000] window matches the actual data span
    // instead of being dwarfed by the real wall-clock "now" (which would collapse everything
    // into a single, enormous bucket).
    const history = readStatsHistory('server-a', 0, 10, 99000)
    expect(history.length).toBeGreaterThan(1)
    expect(history.length).toBeLessThanOrEqual(10)
    // Chronological order preserved.
    for (let i = 1; i < history.length; i++) {
      expect(history[i].time).toBeGreaterThan(history[i - 1].time)
    }
  })

  it('does not stack-overflow finding the earliest sample on a large "All" query', () => {
    // A naive Math.min(...samples.map(s => s.time)) spreads every element as its own
    // function argument, which throws "Maximum call stack size exceeded" well before this
    // many samples - a single profile with stats enabled reaches six figures of recorded
    // samples within days (one roughly every 5s). Written directly rather than through
    // recordStatSample (which does a stat+read on every single call) so the test itself
    // stays fast.
    const SAMPLE_COUNT = 200_000
    const lines: string[] = []
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      lines.push(JSON.stringify({ profileId: 'server-a', time: i, cpu: 1, memoryMB: 1, players: 0 }))
    }
    fs.mkdirSync(path.dirname(logPath()), { recursive: true })
    fs.writeFileSync(logPath(), lines.join('\n') + '\n')

    expect(() => readStatsHistory('server-a', null, 500, SAMPLE_COUNT)).not.toThrow()
    const history = readStatsHistory('server-a', null, 500, SAMPLE_COUNT)
    expect(history.length).toBeGreaterThan(0)
    // The first bucket's own reported time is its *last* sample (see bucketAverage) - just
    // confirm it's the earliest bucket, not that the whole 200,000-sample range got lost.
    expect(history[0].time).toBeLessThan(SAMPLE_COUNT / 100)

    expect(() => readClusterStatsHistory(['server-a'], null, 500, SAMPLE_COUNT)).not.toThrow()
    expect(() =>
      readClusterStatsHistoryForGroups({ SomeGroup: ['server-a'] }, null, 500, SAMPLE_COUNT)
    ).not.toThrow()
  })

  it('sums CPU/RAM/players across multiple profiles per time bucket for a group query', () => {
    recordStatSample('server-a', { time: 1000, cpu: 10, memoryMB: 100, players: 1 })
    recordStatSample('server-b', { time: 1000, cpu: 20, memoryMB: 200, players: 2 })

    const combined = readClusterStatsHistory(['server-a', 'server-b'], null, 1, 1000)
    expect(combined).toHaveLength(1)
    expect(combined[0]).toMatchObject({ cpu: 30, memoryMB: 300, players: 3 })
  })

  it('a group query ignores profiles not in the requested list', () => {
    recordStatSample('server-a', { time: 1000, cpu: 10, memoryMB: 100, players: 1 })
    recordStatSample('server-other', { time: 1000, cpu: 999, memoryMB: 999, players: 9 })

    const combined = readClusterStatsHistory(['server-a'], null, 1, 1000)
    expect(combined).toEqual([{ time: 1000, cpu: 10, memoryMB: 100, players: 1 }])
  })

  it('readClusterStatsHistoryForGroups returns the same result per group as readClusterStatsHistory would individually', () => {
    recordStatSample('server-a', { time: 1000, cpu: 10, memoryMB: 100, players: 1 })
    recordStatSample('server-b', { time: 1000, cpu: 20, memoryMB: 200, players: 2 })
    recordStatSample('server-c', { time: 1000, cpu: 5, memoryMB: 50, players: 0 })

    const byGroup = readClusterStatsHistoryForGroups(
      { GroupOne: ['server-a', 'server-b'], GroupTwo: ['server-c'] },
      null,
      1,
      1000
    )
    expect(byGroup.GroupOne).toEqual(readClusterStatsHistory(['server-a', 'server-b'], null, 1, 1000))
    expect(byGroup.GroupTwo).toEqual(readClusterStatsHistory(['server-c'], null, 1, 1000))
    expect(byGroup.GroupOne[0]).toMatchObject({ cpu: 30, memoryMB: 300, players: 3 })
  })

  it('readClusterStatsHistoryForGroups only reads the history file once regardless of group count', () => {
    const readFileSyncSpy = vi.spyOn(fs, 'readFileSync')
    recordStatSample('server-a', { time: 1000, cpu: 10, memoryMB: 100, players: 1 })
    recordStatSample('server-b', { time: 1000, cpu: 20, memoryMB: 200, players: 2 })
    readFileSyncSpy.mockClear()

    readClusterStatsHistoryForGroups(
      { GroupOne: ['server-a'], GroupTwo: ['server-b'], GroupThree: ['server-a', 'server-b'] },
      null,
      1,
      1000
    )

    expect(readFileSyncSpy).toHaveBeenCalledTimes(1)
    readFileSyncSpy.mockRestore()
  })

  it('drops a trailing bucket that only some profiles have reported into yet, rather than understating the total', () => {
    // Both profiles land a sample in every 1000ms bucket up through t=3000 - a settled,
    // fully-populated tail. Only server-a has reported into the newest bucket (t=4000) by
    // the time this is read; server-b's own recording tick just hasn't fired yet. Without
    // dropping that partial bucket, the combined series would end on a bogus dip (10+100
    // instead of the true, about-to-arrive ~30+300).
    for (const time of [1000, 2000, 3000]) {
      recordStatSample('server-a', { time, cpu: 10, memoryMB: 100, players: 1 })
      recordStatSample('server-b', { time, cpu: 20, memoryMB: 200, players: 2 })
    }
    recordStatSample('server-a', { time: 4000, cpu: 10, memoryMB: 100, players: 1 })

    const combined = readClusterStatsHistory(['server-a', 'server-b'], null, 4, 4000)
    expect(combined).toHaveLength(3)
    expect(combined[combined.length - 1]).toMatchObject({ time: 3000, cpu: 30, memoryMB: 300, players: 3 })
  })

  it('keeps a trailing bucket once every profile that is still reporting has landed a sample in it', () => {
    for (const time of [1000, 2000]) {
      recordStatSample('server-a', { time, cpu: 10, memoryMB: 100, players: 1 })
      recordStatSample('server-b', { time, cpu: 20, memoryMB: 200, players: 2 })
    }
    // The newest bucket has full coverage (both profiles reported), same as the one before
    // it - nothing here looks partial, so it must not be dropped.
    recordStatSample('server-a', { time: 3000, cpu: 10, memoryMB: 100, players: 1 })
    recordStatSample('server-b', { time: 3000, cpu: 20, memoryMB: 200, players: 2 })

    const combined = readClusterStatsHistory(['server-a', 'server-b'], null, 3, 3000)
    expect(combined).toHaveLength(3)
    expect(combined[combined.length - 1]).toMatchObject({ time: 3000, cpu: 30, memoryMB: 300, players: 3 })
  })

  it('trims the oldest content once the global size cap is exceeded, regardless of which profile it belongs to', () => {
    mockSettings.statsHistoryMaxSizeMB = 1
    recordStatSample('server-a', { time: 1, cpu: 1, memoryMB: 1, players: 1 })
    // A unique marker deep in the JSON so it's easy to assert on directly against the raw file.
    fs.appendFileSync(
      logPath(),
      JSON.stringify({ profileId: 'server-a', time: 2, cpu: 1, memoryMB: 1, players: 1, marker: 'UNIQUE_OLD_MARKER' }) +
        '\n'
    )

    // Each iteration ends with a recordStatSample call, since that's what actually performs
    // the trim check - a raw filler append by itself wouldn't trigger one.
    const filler = 'x'.repeat(2000)
    for (let i = 0; i < 1000; i++) {
      fs.appendFileSync(logPath(), filler + '\n')
      recordStatSample('server-b', { time: 1000 + i, cpu: 1, memoryMB: 1, players: 1 })
    }

    const raw = fs.readFileSync(logPath(), 'utf-8')
    expect(raw).not.toContain('UNIQUE_OLD_MARKER')
    expect(fs.statSync(logPath()).size).toBeLessThanOrEqual(1024 * 1024)
  })

  it('skips a corrupt line instead of losing the whole history to it', () => {
    recordStatSample('server-a', { time: 1000, cpu: 10, memoryMB: 100, players: 1 })
    fs.appendFileSync(logPath(), 'not valid json\n')
    recordStatSample('server-a', { time: 2000, cpu: 20, memoryMB: 200, players: 2 })

    expect(readStatsHistory('server-a', null, 500, 2000)).toEqual([
      { time: 1000, cpu: 10, memoryMB: 100, players: 1 },
      { time: 2000, cpu: 20, memoryMB: 200, players: 2 }
    ])
  })
})
