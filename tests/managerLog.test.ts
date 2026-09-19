import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
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

  it('reports an empty log before anything has ever been recorded', () => {
    expect(readManagerLog()).toEqual([])
  })

  it('appends an entry and reads it back with the right shape', () => {
    logManagerEvent('task-1', 'Start — Test', 'Started')

    const entries = readManagerLog()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ taskId: 'task-1', taskLabel: 'Start — Test', message: 'Started', level: 'info' })
    expect(entries[0].date).toMatch(/^\d{4}\.\d{2}\.\d{2}$/)
    expect(entries[0].ts).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  it('defaults to info level but accepts an explicit error level', () => {
    logManagerEvent('task-1', 'Backup — Test', 'Failed: disk full', 'error')

    expect(readManagerLog()).toContainEqual(expect.objectContaining({ level: 'error', message: 'Failed: disk full' }))
  })

  it('keeps multiple entries sharing the same taskId in order, for a multi-step task', () => {
    logManagerEvent('task-restart', 'Scheduled Restart — Test', 'Stopping...')
    logManagerEvent('task-restart', 'Scheduled Restart — Test', 'Stopped')
    logManagerEvent('task-restart', 'Scheduled Restart — Test', 'Starting...')
    logManagerEvent('task-restart', 'Scheduled Restart — Test', 'Started')

    const entries = readManagerLog().filter((e) => e.taskId === 'task-restart')
    expect(entries.map((e) => e.message)).toEqual(['Stopping...', 'Stopped', 'Starting...', 'Started'])
  })

  it('emits a "log" event with the new entry every time one is recorded', () => {
    const seen: unknown[] = []
    const listener = (entry: unknown): void => {
      seen.push(entry)
    }
    managerLogEvents.on('log', listener)
    try {
      logManagerEvent('task-2', 'Kill — Test', 'Killed')
      expect(seen).toHaveLength(1)
      expect(seen[0]).toMatchObject({ taskId: 'task-2', message: 'Killed' })
    } finally {
      managerLogEvents.off('log', listener)
    }
  })

  it('newTaskId returns unique ids even for the same prefix', () => {
    const ids = new Set(Array.from({ length: 20 }, () => newTaskId('start')))
    expect(ids.size).toBe(20)
    for (const id of ids) expect(id.startsWith('start-')).toBe(true)
  })

  it('trims the oldest content once the log exceeds its size cap', () => {
    logManagerEvent('marker', 'Marker Task', 'UNIQUE_OLD_MARKER')

    // Push well past the 5MB cap with a modest number of large entries after the marker,
    // rather than tens of thousands of tiny ones - same end state, far fewer fs round-trips.
    const filler = 'x'.repeat(2000)
    for (let i = 0; i < 3000; i++) {
      logManagerEvent(`filler-${i}`, 'Filler Task', filler)
    }

    const raw = fs.readFileSync(logPath(), 'utf-8')
    expect(raw).not.toContain('UNIQUE_OLD_MARKER')
    expect(fs.statSync(logPath()).size).toBeLessThanOrEqual(5 * 1024 * 1024)
  })

  it('skips a corrupt line instead of losing the whole log to it', () => {
    logManagerEvent('task-3', 'Start — Test', 'Started')
    fs.appendFileSync(logPath(), 'not valid json\n')
    logManagerEvent('task-4', 'Stop — Test', 'Stopped')

    const entries = readManagerLog()
    expect(entries.map((e) => e.taskId)).toEqual(['task-3', 'task-4'])
  })
})
