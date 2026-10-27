import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// managerLog.ts's file path lives under getDataDir(), which normally goes through
// Electron's app.getPath() - unavailable in this Node test environment. Point it at a real
// temp dir instead, same pattern as clusterLogArchive.test.ts.
const { mockDataDir } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('node:os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('node:path')
  return { mockDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'manager-log-datadir-')) }
})
vi.mock('../src/main/lib/dataDir', () => ({ getDataDir: () => mockDataDir }))

import { logManagerEvent, readManagerLog, newTaskId, managerLogEvents } from '../src/main/lib/managerLog'

function logPath(): string {
  return path.join(mockDataDir, 'logs', 'manager.jsonl')
}

describe('managerLog', () => {
  afterEach(() => {
    fs.rmSync(logPath(), { force: true })
  })

  it('reports an empty log before anything has ever been recorded', async () => {
    expect(await readManagerLog()).toEqual([])
  })

  it('appends an entry and reads it back with the right shape', async () => {
    await logManagerEvent('task-1', 'Start — Test', 'Started')

    const entries = await readManagerLog()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ taskId: 'task-1', taskLabel: 'Start — Test', message: 'Started', level: 'info' })
    expect(entries[0].date).toMatch(/^\d{4}\.\d{2}\.\d{2}$/)
    expect(entries[0].ts).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  it('defaults to info level but accepts an explicit error level', async () => {
    await logManagerEvent('task-1', 'Backup — Test', 'Failed: disk full', 'error')

    expect(await readManagerLog()).toContainEqual(expect.objectContaining({ level: 'error', message: 'Failed: disk full' }))
  })

  it('keeps multiple entries sharing the same taskId in order, for a multi-step task', async () => {
    // logManagerEvent fires its disk write in the background (see its own comment) - awaited
    // here one at a time specifically so this test can assert the on-disk order, which a real
    // caller (fire-and-forget, never awaited) doesn't need to care about.
    await logManagerEvent('task-restart', 'Scheduled Restart — Test', 'Stopping...')
    await logManagerEvent('task-restart', 'Scheduled Restart — Test', 'Stopped')
    await logManagerEvent('task-restart', 'Scheduled Restart — Test', 'Starting...')
    await logManagerEvent('task-restart', 'Scheduled Restart — Test', 'Started')

    const entries = (await readManagerLog()).filter((e) => e.taskId === 'task-restart')
    expect(entries.map((e) => e.message)).toEqual(['Stopping...', 'Stopped', 'Starting...', 'Started'])
  })

  it('emits a "log" event with the new entry every time one is recorded', async () => {
    const seen: unknown[] = []
    const listener = (entry: unknown): void => {
      seen.push(entry)
    }
    managerLogEvents.on('log', listener)
    try {
      await logManagerEvent('task-2', 'Kill — Test', 'Killed')
      expect(seen).toHaveLength(1)
      expect(seen[0]).toMatchObject({ taskId: 'task-2', message: 'Killed' })
    } finally {
      managerLogEvents.off('log', listener)
    }
  })

  it('emits the "log" event synchronously (before the disk write settles), not after', () => {
    // The live Manager Log view appends from this event, not from re-reading the file - it
    // must not wait on the (now backgrounded) disk write to see a just-recorded entry.
    const seen: unknown[] = []
    const listener = (entry: unknown): void => {
      seen.push(entry)
    }
    managerLogEvents.on('log', listener)
    try {
      logManagerEvent('task-sync', 'Kill — Test', 'Killed')
      expect(seen).toHaveLength(1)
    } finally {
      managerLogEvents.off('log', listener)
    }
  })

  it('newTaskId returns unique ids even for the same prefix', () => {
    const ids = new Set(Array.from({ length: 20 }, () => newTaskId('start')))
    expect(ids.size).toBe(20)
    for (const id of ids) expect(id.startsWith('start-')).toBe(true)
  })

  it(
    'trims the oldest content once the log exceeds its size cap',
    async () => {
      await logManagerEvent('marker', 'Marker Task', 'UNIQUE_OLD_MARKER')

      // Push well past the 5MB cap with a modest number of large entries after the marker,
      // rather than tens of thousands of tiny ones - same end state, far fewer fs round-trips.
      // Awaited one at a time (see this file's own comment on the multi-step-task test above),
      // which is noticeably slower than the old fs.*Sync version purely from 3000 sequential
      // async round-trips - hence the longer timeout below, not a sign of anything actually
      // wrong.
      const filler = 'x'.repeat(2000)
      for (let i = 0; i < 3000; i++) {
        await logManagerEvent(`filler-${i}`, 'Filler Task', filler)
      }

      const raw = await fsPromises.readFile(logPath(), 'utf-8')
      expect(raw).not.toContain('UNIQUE_OLD_MARKER')
      const { size } = await fsPromises.stat(logPath())
      expect(size).toBeLessThanOrEqual(5 * 1024 * 1024)
    },
    20000
  )

  it('skips a corrupt line instead of losing the whole log to it', async () => {
    await logManagerEvent('task-3', 'Start — Test', 'Started')
    await fsPromises.appendFile(logPath(), 'not valid json\n')
    await logManagerEvent('task-4', 'Stop — Test', 'Stopped')

    const entries = await readManagerLog()
    expect(entries.map((e) => e.taskId)).toEqual(['task-3', 'task-4'])
  })

  it('never throws when the disk write itself fails - a real report on Windows had this crash every start/stop/kill', async () => {
    // logManagerEvent is called directly from doStartServer/doStopServer/doKillServer/... -
    // if its returned promise rejected uncaught, the actual action it's attached to would be
    // reported as failed even when it had already succeeded (see the fix's own comment in
    // managerLog.ts) - it never throws/rejects regardless of a disk failure.
    const spy = vi.spyOn(fsPromises, 'appendFile').mockRejectedValue(
      Object.assign(new Error('unknown error, write'), { code: 'UNKNOWN', errno: -4094 })
    )
    try {
      await expect(logManagerEvent('task-5', 'Stop — Test', 'Stopped')).resolves.toBeUndefined()
    } finally {
      spy.mockRestore()
    }
  })

  it('still emits the "log" event live even when persisting to disk fails', async () => {
    const spy = vi.spyOn(fsPromises, 'appendFile').mockRejectedValue(new Error('disk full'))
    const seen: unknown[] = []
    const listener = (entry: unknown): void => {
      seen.push(entry)
    }
    managerLogEvents.on('log', listener)
    try {
      await logManagerEvent('task-6', 'Kill — Test', 'Killed')
      expect(seen).toHaveLength(1)
    } finally {
      managerLogEvents.off('log', listener)
      spy.mockRestore()
    }
  })

  it('returns an empty log instead of throwing when the disk read itself fails', async () => {
    await logManagerEvent('task-7', 'Start — Test', 'Started')
    const spy = vi.spyOn(fsPromises, 'readFile').mockRejectedValue(
      Object.assign(new Error('unknown error, read'), { code: 'UNKNOWN', errno: -4094 })
    )
    try {
      expect(await readManagerLog()).toEqual([])
    } finally {
      spy.mockRestore()
    }
  })
})
