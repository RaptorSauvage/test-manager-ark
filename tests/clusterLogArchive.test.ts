import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerProfile, ServerStatus } from '../shared/types'

// clusterLogArchive.ts's file paths live under getDataDir(), normally Electron's
// app.getPath() - unavailable in this Node test environment. Point it at a real temp dir
// instead, same pattern as groupConsole.test.ts.
const { mockDataDir } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('node:os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('node:path')
  return { mockDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cluster-log-archive-datadir-')) }
})
vi.mock('../src/main/lib/dataDir', () => ({ getDataDir: () => mockDataDir }))

import { serverEvents } from '../src/main/lib/serverProcess'
import {
  getClusterLogArchivePath,
  readClusterLogArchiveBacklog,
  hasClusterLogArchive,
  startClusterLogArchiveWatch,
  stopClusterLogArchiveWatch,
  registerClusterLogArchiveWatch
} from '../src/main/lib/clusterLogArchive'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeProfile(overrides: Partial<ServerProfile> = {}): ServerProfile {
  return {
    id: 'archive-test',
    name: 'ArchiveTest',
    installDir: '',
    clusterLogArchiveMaxSizeMB: 10,
    ...overrides
  } as ServerProfile
}

function logPathFor(installDir: string): string {
  return path.join(installDir, 'ShooterGame', 'Saved', 'Logs', 'ShooterGame.log')
}

function writeLog(installDir: string, content: string): void {
  const logDir = path.join(installDir, 'ShooterGame', 'Saved', 'Logs')
  fs.mkdirSync(logDir, { recursive: true })
  fs.writeFileSync(path.join(logDir, 'ShooterGame.log'), content)
}

const joinLine =
  '[2026.07.27-21.25.23:191][991]2026.07.27_21.25.23: LeRaptorSauvage [UniqueNetId:0002dbe9ab20413e9b8e7e1562b76868 Platform:None] joined this ARK!'

describe('clusterLogArchive', () => {
  let testDir: string

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cluster-log-archive-test-'))
  })

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  it('getClusterLogArchivePath places the file under getDataDir(), named after the profile', () => {
    const p = getClusterLogArchivePath('some-profile-id')
    expect(p.startsWith(mockDataDir)).toBe(true)
    expect(p.endsWith('some-profile-id.log')).toBe(true)
  })

  it('reports no archive and an empty backlog before anything has ever been watched', () => {
    expect(hasClusterLogArchive('never-watched')).toBe(false)
    expect(readClusterLogArchiveBacklog('never-watched')).toEqual([])
  })

  it('appends new log growth to the permanent archive while watching, surviving after the watch stops', async () => {
    const installDir = path.join(testDir, 'server')
    writeLog(installDir, '')
    const profile = makeProfile({ id: 'archive-basic', installDir })

    startClusterLogArchiveWatch(profile, 20)
    await wait(60) // let it capture the baseline (empty) size first

    fs.appendFileSync(logPathFor(installDir), joinLine + '\n')
    await wait(150)
    stopClusterLogArchiveWatch(profile.id)

    expect(hasClusterLogArchive(profile.id)).toBe(true)
    expect(readClusterLogArchiveBacklog(profile.id)).toContainEqual(expect.objectContaining({ label: 'JOIN' }))
  })

  it('keeps archiving across a simulated server restart (log truncated back to empty)', async () => {
    const installDir = path.join(testDir, 'restart-server')
    writeLog(installDir, '')
    const profile = makeProfile({ id: 'archive-restart', installDir })

    startClusterLogArchiveWatch(profile, 20)
    await wait(60)

    fs.appendFileSync(logPathFor(installDir), joinLine + '\n')
    await wait(150)

    // Simulate the server restarting: ARK truncates/replaces ShooterGame.log with a fresh,
    // empty one for the new session - the archive should still hold the old session's line.
    fs.writeFileSync(logPathFor(installDir), '')
    await wait(150)
    stopClusterLogArchiveWatch(profile.id)

    expect(readClusterLogArchiveBacklog(profile.id)).toContainEqual(expect.objectContaining({ label: 'JOIN' }))
  })

  it('trims the oldest content once the per-profile size cap is exceeded', async () => {
    const installDir = path.join(testDir, 'rotate-server')
    writeLog(installDir, '')
    const profile = makeProfile({ id: 'archive-rotate', installDir, clusterLogArchiveMaxSizeMB: 1 })

    startClusterLogArchiveWatch(profile, 20)
    await wait(60)

    fs.appendFileSync(logPathFor(installDir), 'UNIQUE_OLD_MARKER_LINE\n')
    await wait(150)

    // Push well past the 1MB cap with filler after the marker.
    const filler = 'x'.repeat(1024) + '\n'
    fs.appendFileSync(logPathFor(installDir), filler.repeat(1100)) // ~1.1MB
    await wait(300)
    stopClusterLogArchiveWatch(profile.id)

    const archived = fs.readFileSync(getClusterLogArchivePath(profile.id), 'utf-8')
    expect(archived).not.toContain('UNIQUE_OLD_MARKER_LINE')
    expect(fs.statSync(getClusterLogArchivePath(profile.id)).size).toBeLessThanOrEqual(1024 * 1024)
  })

  it('stops appending once the watch is stopped', async () => {
    const installDir = path.join(testDir, 'stop-server')
    writeLog(installDir, '')
    const profile = makeProfile({ id: 'archive-stop', installDir })

    startClusterLogArchiveWatch(profile, 20)
    await wait(60)
    stopClusterLogArchiveWatch(profile.id)

    fs.appendFileSync(logPathFor(installDir), joinLine + '\n')
    await wait(150)

    expect(hasClusterLogArchive(profile.id)).toBe(false)
  })

  it('registerClusterLogArchiveWatch starts on starting and stops on stopped/error', async () => {
    const installDir = path.join(testDir, 'register-server')
    writeLog(installDir, '')
    const profile = makeProfile({ id: 'archive-register', installDir })

    registerClusterLogArchiveWatch((id) => (id === profile.id ? profile : undefined), 20)
    try {
      serverEvents.emit('status', { profileId: profile.id, state: 'starting' } as ServerStatus)
      await wait(60)

      fs.appendFileSync(logPathFor(installDir), joinLine + '\n')
      await wait(150)
      expect(hasClusterLogArchive(profile.id)).toBe(true)

      serverEvents.emit('status', { profileId: profile.id, state: 'stopped' } as ServerStatus)
      await wait(60)

      const sizeBeforeMoreWrites = fs.statSync(getClusterLogArchivePath(profile.id)).size
      fs.appendFileSync(logPathFor(installDir), joinLine + '\n')
      await wait(150)
      expect(fs.statSync(getClusterLogArchivePath(profile.id)).size).toBe(sizeBeforeMoreWrites)
    } finally {
      stopClusterLogArchiveWatch(profile.id)
    }
  })
})
