import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerProfile, ServerStatus } from '../shared/types'
import { serverEvents } from '../src/main/lib/serverProcess'
import { getGroupConsoleBacklog, watchGroupConsole } from '../src/main/lib/groupConsole'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeProfile(id: string, name: string, installDir: string): ServerProfile {
  return { id, name, installDir } as ServerProfile
}

function writeLog(installDir: string, content: string): void {
  const logDir = path.join(installDir, 'ShooterGame', 'Saved', 'Logs')
  fs.mkdirSync(logDir, { recursive: true })
  fs.writeFileSync(path.join(logDir, 'ShooterGame.log'), content)
}

const joinLine =
  '[2026.07.27-21.25.23:191][991]2026.07.27_21.25.23: LeRaptorSauvage [UniqueNetId:0002dbe9ab20413e9b8e7e1562b76868 Platform:None] joined this ARK!'
const leaveLineSameTimeNextDay =
  '[2026.07.28-21.25.23:084][345]2026.07.28_21.25.23: LeRaptorSauvage [UniqueNetId:0002dbe9ab20413e9b8e7e1562b76868 Platform:None] left this ARK!'
const leaveLineEarlier =
  '[2026.07.27-21.10.35:084][345]2026.07.27_21.10.35: LeRaptorSauvage [UniqueNetId:0002dbe9ab20413e9b8e7e1562b76868 Platform:None] left this ARK!'

describe('getGroupConsoleBacklog', () => {
  const testDir = path.join(os.tmpdir(), `group-console-backlog-test-${process.pid}`)
  const dirA = path.join(testDir, 'a')
  const dirB = path.join(testDir, 'b')

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  it('tags every event with its profile and merges them sorted by time', () => {
    writeLog(dirA, joinLine) // ts 21:25:23
    writeLog(dirB, leaveLineEarlier) // ts 21:10:35, earlier

    const result = getGroupConsoleBacklog([makeProfile('a', 'ServerA', dirA), makeProfile('b', 'ServerB', dirB)])

    expect(result).toEqual([
      expect.objectContaining({ profileId: 'b', profileName: 'ServerB', label: 'LEFT', ts: '21:10:35' }),
      expect.objectContaining({ profileId: 'a', profileName: 'ServerA', label: 'JOIN', ts: '21:25:23' })
    ])
  })

  it('sorts by date first, not just by time-of-day, so a later day sorts after an earlier one despite the same HH:MM:SS', () => {
    writeLog(dirA, leaveLineSameTimeNextDay) // 2026.07.28, ts 21:25:23
    writeLog(dirB, joinLine) // 2026.07.27, ts 21:25:23 - earlier day, same time

    const result = getGroupConsoleBacklog([makeProfile('a', 'ServerA', dirA), makeProfile('b', 'ServerB', dirB)])

    expect(result.map((e) => e.profileId)).toEqual(['b', 'a'])
  })

  it('returns an empty array when none of the profiles have a log file yet', () => {
    expect(getGroupConsoleBacklog([makeProfile('a', 'ServerA', dirA)])).toEqual([])
  })
})

describe('watchGroupConsole', () => {
  let testDir: string
  let dirA: string
  let dirB: string

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'group-console-watch-test-'))
    dirA = path.join(testDir, 'a')
    dirB = path.join(testDir, 'b')
    writeLog(dirA, '')
    writeLog(dirB, '')
  })

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  it('only tails profiles the injected isRunning predicate reports as running', async () => {
    const events: Array<{ profileId: string; label: string }> = []
    const stop = watchGroupConsole(
      [makeProfile('a', 'ServerA', dirA), makeProfile('b', 'ServerB', dirB)],
      (event) => events.push(event),
      20,
      (id) => id === 'a'
    )
    await wait(60) // let it capture the initial (empty) file sizes as the baseline first

    fs.appendFileSync(path.join(dirA, 'ShooterGame', 'Saved', 'Logs', 'ShooterGame.log'), joinLine + '\n')
    fs.appendFileSync(path.join(dirB, 'ShooterGame', 'Saved', 'Logs', 'ShooterGame.log'), leaveLineEarlier + '\n')
    await wait(150)
    stop()

    expect(events).toContainEqual(expect.objectContaining({ profileId: 'a', label: 'JOIN' }))
    expect(events).not.toContainEqual(expect.objectContaining({ profileId: 'b' }))
  })

  it('starts tailing a profile once it transitions to running, and stops once it stops', async () => {
    const events: Array<{ profileId: string; label: string }> = []
    const stop = watchGroupConsole(
      [makeProfile('a', 'ServerA', dirA)],
      (event) => events.push(event),
      20,
      () => false // nothing running yet at subscribe time
    )
    await wait(60)

    // Before the 'running' transition: appending shouldn't be picked up (no tailer yet).
    fs.appendFileSync(path.join(dirA, 'ShooterGame', 'Saved', 'Logs', 'ShooterGame.log'), leaveLineEarlier + '\n')
    await wait(60)
    expect(events).toEqual([])

    serverEvents.emit('status', { profileId: 'a', state: 'running' } as ServerStatus)
    await wait(60) // let the newly-started tailer capture the current (already grown) file size as its baseline

    fs.appendFileSync(path.join(dirA, 'ShooterGame', 'Saved', 'Logs', 'ShooterGame.log'), joinLine + '\n')
    await wait(150)
    expect(events).toContainEqual(expect.objectContaining({ profileId: 'a', label: 'JOIN' }))

    events.length = 0
    serverEvents.emit('status', { profileId: 'a', state: 'stopped' } as ServerStatus)
    await wait(60)

    fs.appendFileSync(path.join(dirA, 'ShooterGame', 'Saved', 'Logs', 'ShooterGame.log'), leaveLineEarlier + '\n')
    await wait(150)
    expect(events).toEqual([])

    stop()
  })

  it('stops every tailer and unsubscribes once the returned function is called', async () => {
    const events: unknown[] = []
    const stop = watchGroupConsole([makeProfile('a', 'ServerA', dirA)], (event) => events.push(event), 20, () => true)
    await wait(60)
    stop()

    fs.appendFileSync(path.join(dirA, 'ShooterGame', 'Saved', 'Logs', 'ShooterGame.log'), joinLine + '\n')
    await wait(150)
    expect(events).toEqual([])

    // The status listener should also be gone - emitting shouldn't start a fresh tailer.
    serverEvents.emit('status', { profileId: 'a', state: 'running' } as ServerStatus)
    await wait(150)
    expect(events).toEqual([])
  })
})
