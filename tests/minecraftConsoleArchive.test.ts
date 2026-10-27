import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Same pattern as clusterLogArchive.test.ts - getDataDir() normally goes through Electron's
// app.getPath(), unavailable in this Node test environment.
const { mockDataDir } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('node:os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('node:path')
  return { mockDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'minecraft-console-archive-datadir-')) }
})
vi.mock('../src/main/lib/dataDir', () => ({ getDataDir: () => mockDataDir }))

import {
  getMinecraftConsoleArchivePath,
  appendConsoleLineToArchive,
  readMinecraftConsoleArchive,
  queueConsoleLineForArchive,
  flushQueuedConsoleLines
} from '../src/main/lib/minecraftConsoleArchive'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('minecraftConsoleArchive', () => {
  let profileId: string

  beforeEach(() => {
    profileId = `archive-test-${Math.random().toString(36).slice(2)}`
  })

  afterEach(() => {
    fs.rmSync(getMinecraftConsoleArchivePath(profileId), { force: true })
  })

  it('places the archive file under getDataDir(), named after the profile', () => {
    const p = getMinecraftConsoleArchivePath(profileId)
    expect(p.startsWith(mockDataDir)).toBe(true)
    expect(p.endsWith(`${profileId}.jsonl`)).toBe(true)
  })

  it('reads back appended lines in order', async () => {
    await appendConsoleLineToArchive(profileId, { text: 'first line', ts: 1 })
    await appendConsoleLineToArchive(profileId, { text: 'second line', ts: 2 })

    const lines = await readMinecraftConsoleArchive(profileId)
    expect(lines.map((l) => l.text)).toEqual(['first line', 'second line'])
  })

  it('returns an empty array when nothing has been archived yet', async () => {
    expect(await readMinecraftConsoleArchive(profileId)).toEqual([])
  })

  it('trims the archive back under maxBytes once it grows past it, keeping the most recent lines', async () => {
    const maxBytes = 200
    for (let i = 0; i < 50; i++) {
      await appendConsoleLineToArchive(profileId, { text: `line-${i}`, ts: i }, maxBytes)
    }

    const archivePath = getMinecraftConsoleArchivePath(profileId)
    const size = fs.statSync(archivePath).size
    expect(size).toBeLessThanOrEqual(maxBytes)

    const lines = await readMinecraftConsoleArchive(profileId)
    expect(lines.length).toBeGreaterThan(0)
    // The most recent line must always survive a trim.
    expect(lines.at(-1)?.text).toBe('line-49')
    // Earliest lines must have been dropped once the file exceeded maxBytes.
    expect(lines.some((l) => l.text === 'line-0')).toBe(false)
  })

  // Regression test for a real report: a big modpack's startup prints thousands of console
  // lines within seconds, and the previous design (one independent fs round-trip per line,
  // via appendConsoleLineToArchive) flooded the Electron main process's I/O badly enough to
  // freeze the Manager for minutes - confirmed by a watchdog that caught it recurring with
  // near-0% CPU throughout (I/O-bound, not compute-bound). queueConsoleLineForArchive batches
  // everything queued within the same short window into a single append instead.
  it('batches many lines queued within the same window into a single append call', async () => {
    const appendFileSpy = vi.spyOn(fsPromises, 'appendFile')
    try {
      for (let i = 0; i < 200; i++) {
        queueConsoleLineForArchive(profileId, { text: `burst-${i}`, ts: i })
      }
      // Nothing written yet - still within the flush window.
      expect(appendFileSpy).not.toHaveBeenCalled()

      await wait(400)

      expect(appendFileSpy).toHaveBeenCalledTimes(1)
      const lines = await readMinecraftConsoleArchive(profileId)
      expect(lines).toHaveLength(200)
      expect(lines[0].text).toBe('burst-0')
      expect(lines.at(-1)?.text).toBe('burst-199')
    } finally {
      appendFileSpy.mockRestore()
    }
  })

  it('flushQueuedConsoleLines writes out a pending batch immediately instead of waiting for the next scheduled flush', async () => {
    queueConsoleLineForArchive(profileId, { text: 'flush-me', ts: 1 })

    flushQueuedConsoleLines(profileId)
    await wait(10) // the flush's own write is still async - give it a tick to land

    const lines = await readMinecraftConsoleArchive(profileId)
    expect(lines.map((l) => l.text)).toEqual(['flush-me'])
  })
})
