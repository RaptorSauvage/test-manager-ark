import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
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
  readMinecraftConsoleArchive
} from '../src/main/lib/minecraftConsoleArchive'

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

  it('reads back appended lines in order', () => {
    appendConsoleLineToArchive(profileId, { text: 'first line', ts: 1 })
    appendConsoleLineToArchive(profileId, { text: 'second line', ts: 2 })

    const lines = readMinecraftConsoleArchive(profileId)
    expect(lines.map((l) => l.text)).toEqual(['first line', 'second line'])
  })

  it('returns an empty array when nothing has been archived yet', () => {
    expect(readMinecraftConsoleArchive(profileId)).toEqual([])
  })

  it('trims the archive back under maxBytes once it grows past it, keeping the most recent lines', () => {
    const maxBytes = 200
    for (let i = 0; i < 50; i++) {
      appendConsoleLineToArchive(profileId, { text: `line-${i}`, ts: i }, maxBytes)
    }

    const archivePath = getMinecraftConsoleArchivePath(profileId)
    const size = fs.statSync(archivePath).size
    expect(size).toBeLessThanOrEqual(maxBytes)

    const lines = readMinecraftConsoleArchive(profileId)
    expect(lines.length).toBeGreaterThan(0)
    // The most recent line must always survive a trim.
    expect(lines.at(-1)?.text).toBe('line-49')
    // Earliest lines must have been dropped once the file exceeded maxBytes.
    expect(lines.some((l) => l.text === 'line-0')).toBe(false)
  })
})
