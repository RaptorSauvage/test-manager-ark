import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerProfile } from '../shared/types'
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
const leaveLineEarlier =
  '[2026.07.27-21.10.35:084][345]2026.07.27_21.10.35: LeRaptorSauvage [UniqueNetId:0002dbe9ab20413e9b8e7e1562b76868 Platform:None] left this ARK!'

describe('getGroupConsoleBacklog', () => {
  const testDir = path.join(os.tmpdir(), `group-console-backlog-test-${process.pid}`)
  const dirA = path.join(testDir, 'a')
  const dirB = path.join(testDir, 'b')

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  it('tags every event with its profile and merges them sorted by timestamp', () => {
    writeLog(dirA, joinLine) // ts 21:25:23
    writeLog(dirB, leaveLineEarlier) // ts 21:10:35, earlier

    const result = getGroupConsoleBacklog([makeProfile('a', 'ServerA', dirA), makeProfile('b', 'ServerB', dirB)])

    expect(result).toEqual([
      expect.objectContaining({ profileId: 'b', profileName: 'ServerB', label: 'LEFT', ts: '21:10:35' }),
      expect.objectContaining({ profileId: 'a', profileName: 'ServerA', label: 'JOIN', ts: '21:25:23' })
    ])
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

  it('tags live events with the profile they came from, across multiple profiles', async () => {
    const events: Array<{ profileId: string; profileName: string; label: string }> = []
    const stop = watchGroupConsole(
      [makeProfile('a', 'ServerA', dirA), makeProfile('b', 'ServerB', dirB)],
      (event) => events.push(event),
      20
    )
    await wait(60) // let it capture the initial (empty) file sizes as the baseline first

    fs.appendFileSync(path.join(dirA, 'ShooterGame', 'Saved', 'Logs', 'ShooterGame.log'), joinLine + '\n')
    fs.appendFileSync(path.join(dirB, 'ShooterGame', 'Saved', 'Logs', 'ShooterGame.log'), leaveLineEarlier + '\n')
    await wait(150)
    stop()

    expect(events).toContainEqual(expect.objectContaining({ profileId: 'a', profileName: 'ServerA', label: 'JOIN' }))
    expect(events).toContainEqual(expect.objectContaining({ profileId: 'b', profileName: 'ServerB', label: 'LEFT' }))
  })

  it('stops every tailer once the returned function is called', async () => {
    const events: unknown[] = []
    const stop = watchGroupConsole([makeProfile('a', 'ServerA', dirA)], (event) => events.push(event), 20)
    await wait(60)
    stop()

    fs.appendFileSync(path.join(dirA, 'ShooterGame', 'Saved', 'Logs', 'ShooterGame.log'), joinLine + '\n')
    await wait(150)

    expect(events).toEqual([])
  })
})
