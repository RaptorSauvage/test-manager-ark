import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerProfile, ServerStatus } from '../shared/types'

// clusterLogArchive.ts's file paths live under getDataDir(), which normally goes through
// Electron's app.getPath() - unavailable in this Node test environment. Point it at a real
// temp dir instead, same pattern as groupConsole.test.ts.
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

/** A real, parseable JOIN line, with a distinct player name so multiple calls don't collide. */
function joinLineFor(player: string): string {
  return `[2026.07.27-21.25.23:191][991]2026.07.27_21.25.23: ${player} [UniqueNetId:0002dbe9ab20413e9b8e7e1562b76868 Platform:None] joined this ARK!`
}
const joinLine = joinLineFor('LeRaptorSauvage')

/** Lines parseLogLine deliberately discards as internal engine noise - never displayable,
 *  so they should never take up archive space either. */
const noiseLine = '[2026.07.27-21.25.24:200][992]LogTemp: Display: Garbage collection cycle complete.'

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
    expect(p.endsWith('some-profile-id.jsonl')).toBe(true)
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

  it('only archives events susceptible to being displayed, not raw/noise log lines', async () => {
    const installDir = path.join(testDir, 'noise-server')
    writeLog(installDir, '')
    const profile = makeProfile({ id: 'archive-noise-filter', installDir })

    startClusterLogArchiveWatch(profile, 20)
    await wait(60)

    fs.appendFileSync(logPathFor(installDir), noiseLine + '\n' + joinLine + '\n' + noiseLine + '\n')
    await wait(150)
    stopClusterLogArchiveWatch(profile.id)

    const backlog = readClusterLogArchiveBacklog(profile.id)
    expect(backlog).toHaveLength(1)
    expect(backlog[0]).toMatchObject({ label: 'JOIN' })

    // Nothing about the noise line's own text should have leaked into the archive file at all.
    const raw = fs.readFileSync(getClusterLogArchivePath(profile.id), 'utf-8')
    expect(raw).not.toContain('Garbage collection')
  })

  it('does not create an archive file at all when nothing displayable appears', async () => {
    const installDir = path.join(testDir, 'all-noise-server')
    writeLog(installDir, '')
    const profile = makeProfile({ id: 'archive-all-noise', installDir })

    startClusterLogArchiveWatch(profile, 20)
    await wait(60)

    fs.appendFileSync(logPathFor(installDir), noiseLine + '\n')
    await wait(150)
    stopClusterLogArchiveWatch(profile.id)

    expect(hasClusterLogArchive(profile.id)).toBe(false)
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

    fs.appendFileSync(logPathFor(installDir), joinLineFor('UNIQUE_OLD_MARKER_PLAYER') + '\n')
    await wait(150)

    // Push well past the 1MB cap with many more (real, parseable) join lines after the
    // marker - each serializes to roughly ~135 bytes of JSON, so this comfortably clears
    // 1MB on its own regardless of the marker's own (much smaller) contribution.
    const filler = Array.from({ length: 12000 }, (_, i) => joinLineFor(`Filler${i}`)).join('\n') + '\n'
    fs.appendFileSync(logPathFor(installDir), filler)
    await wait(400)
    stopClusterLogArchiveWatch(profile.id)

    const archived = fs.readFileSync(getClusterLogArchivePath(profile.id), 'utf-8')
    expect(archived).not.toContain('UNIQUE_OLD_MARKER_PLAYER')
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
