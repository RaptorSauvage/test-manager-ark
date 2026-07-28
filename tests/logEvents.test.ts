import { describe, expect, it } from 'vitest'
import {
  createLogEventCaches,
  parseLogLine,
  parseLogChunk,
  PLAYER_NAME_OPEN,
  PLAYER_NAME_CLOSE
} from '../src/main/lib/logEvents'

function hl(name: string): string {
  return `${PLAYER_NAME_OPEN}${name}${PLAYER_NAME_CLOSE}`
}

describe('parseLogLine', () => {
  it('parses a join line, with no IP shown when none was looked up', () => {
    const line =
      '[2026.07.27-21.25.23:191][991]2026.07.27_21.25.23: LeRaptorSauvage [UniqueNetId:0002dbe9ab20413e9b8e7e1562b76868 Platform:None] joined this ARK!'
    expect(parseLogLine(line, createLogEventCaches())).toEqual({
      label: 'JOIN',
      cls: 'join',
      text: `${hl('LeRaptorSauvage')} joined the server (ID: 0002dbe9ab20413e9b8e7e1562b76868)`,
      ts: '21:25:23'
    })
  })

  it('includes the looked-up IP on a join line once one has been seen for that account', () => {
    const caches = createLogEventCaches()
    const ipLine = '[2026.07.27-21.25.20:000][990]IP for incoming account 0002dbe9ab20413e9b8e7e1562b76868 - IP 93.24.55.66'
    expect(parseLogLine(ipLine, caches)).toBeNull()

    const joinLine =
      '[2026.07.27-21.25.23:191][991]2026.07.27_21.25.23: LeRaptorSauvage [UniqueNetId:0002dbe9ab20413e9b8e7e1562b76868 Platform:None] joined this ARK!'
    expect(parseLogLine(joinLine, caches)).toEqual({
      label: 'JOIN',
      cls: 'join',
      text: `${hl('LeRaptorSauvage')} joined the server (ID: 0002dbe9ab20413e9b8e7e1562b76868, IP: 93.24.55.66)`,
      ts: '21:25:23'
    })
  })

  it('parses a leave line', () => {
    const line =
      '[2026.07.27-21.25.35:084][345]2026.07.27_21.25.35: LeRaptorSauvage [UniqueNetId:0002dbe9ab20413e9b8e7e1562b76868 Platform:None] left this ARK!'
    expect(parseLogLine(line, createLogEventCaches())).toEqual({
      label: 'LEFT',
      cls: 'leave',
      text: `${hl('LeRaptorSauvage')} left the server`,
      ts: '21:25:35'
    })
  })

  it('parses in-game chat', () => {
    const line = '[2026.07.27-21.26.00:000][100]LeRaptorSauvage (Raptor): Hello world'
    expect(parseLogLine(line, createLogEventCaches())).toEqual({
      label: 'CHAT',
      cls: 'chat',
      text: 'LeRaptorSauvage: Hello world',
      ts: '21:26:00'
    })
  })

  it('parses an admin command with its player name', () => {
    const line = '[2026.07.27-21.27.00:000][101]AdminCmd: DestroyWildDinos (PlayerName: LeRaptorSauvage, UserId: 123)'
    expect(parseLogLine(line, createLogEventCaches())).toEqual({
      label: 'CMD',
      cls: 'cmd',
      text: 'DestroyWildDinos — LeRaptorSauvage',
      ts: '21:27:00'
    })
  })

  it('falls back to the raw text for an admin command it cannot parse the player out of', () => {
    const line = '[2026.07.27-21.27.00:000][101]AdminCmd: SomethingUnexpected'
    expect(parseLogLine(line, createLogEventCaches())).toEqual({
      label: 'CMD',
      cls: 'cmd',
      text: 'AdminCmd: SomethingUnexpected',
      ts: '21:27:00'
    })
  })

  it('resolves a mission event to the player name seen earlier at join, not just their account id', () => {
    const caches = createLogEventCaches()
    const joinLine =
      '[2026.07.27-21.25.23:191][991]2026.07.27_21.25.23: LeRaptorSauvage [UniqueNetId:76561198012345678 Platform:None] joined this ARK!'
    parseLogLine(joinLine, caches)

    const missionLine = '[2026.07.27-21.28.00:000][102]Mission Started: The Volcano by Player: 76561198012345678.'
    expect(parseLogLine(missionLine, caches)).toEqual({
      label: 'MISSION',
      cls: 'mission',
      text: 'Mission started: The Volcano — LeRaptorSauvage',
      ts: '21:28:00'
    })
  })

  it('falls back to the account id for a mission event with no known player name', () => {
    const line = '[2026.07.27-21.28.00:000][102]Mission Started: The Volcano by Player: 76561198012345678.'
    expect(parseLogLine(line, createLogEventCaches())).toEqual({
      label: 'MISSION',
      cls: 'mission',
      text: 'Mission started: The Volcano — 76561198012345678',
      ts: '21:28:00'
    })
  })

  it('parses the startup-complete marker', () => {
    const line = '[2026.07.27-21.00.00:000][1]Server has completed startup and is now advertising for join. (11.75GB Mem)'
    expect(parseLogLine(line, createLogEventCaches())).toEqual({
      label: 'READY',
      cls: 'ready',
      text: 'Server finished startup and is ready for connections (11.75GB Mem)',
      ts: '21:00:00'
    })
  })

  it('parses a cryo freeze line, stripping RichColor tags first', () => {
    const line = '[2026.07.27-21.29.00:000][103]<RichColor Color="1,0,0,1">A Rex froze!</>'
    expect(parseLogLine(line, createLogEventCaches())).toEqual({
      label: 'CRYO',
      cls: 'freeze',
      text: 'A Rex froze!',
      ts: '21:29:00'
    })
  })

  it('drops the complementary "Frozen by ID" line to avoid a duplicate', () => {
    const line = '[2026.07.27-21.29.00:000][103]Frozen by ID 12345'
    expect(parseLogLine(line, createLogEventCaches())).toBeNull()
  })

  it('parses a tame event', () => {
    const line = '[2026.07.27-21.30.00:000][104]LeRaptorSauvage Tamed a Rex - Level 150!'
    expect(parseLogLine(line, createLogEventCaches())).toEqual({
      label: 'TAME',
      cls: 'tame',
      text: 'LeRaptorSauvage Tamed a Rex - Level 150!',
      ts: '21:30:00'
    })
  })

  it('parses a kill event', () => {
    const line = '[2026.07.27-21.31.00:000][105]LeRaptorSauvage was killed by a Rex!'
    expect(parseLogLine(line, createLogEventCaches())).toEqual({
      label: 'KILL',
      cls: 'kill',
      text: 'LeRaptorSauvage was killed by a Rex!',
      ts: '21:31:00'
    })
  })

  it('parses save start/complete lines', () => {
    const caches = createLogEventCaches()
    expect(parseLogLine('[2026.07.27-21.32.00:000][106]Saving world...', caches)).toEqual({
      label: 'SAVE',
      cls: 'save',
      text: 'Automatic save in progress...',
      ts: '21:32:00'
    })
    expect(parseLogLine('[2026.07.27-21.32.05:000][107]World Save Complete!', caches)).toEqual({
      label: 'SAVE',
      cls: 'save',
      text: 'Automatic save complete',
      ts: '21:32:05'
    })
  })

  it('parses a structure-destroyed warning', () => {
    const line = '[2026.07.27-21.33.00:000][108]Structure Wooden Foundation was destroyed at X=1 Y=2 Z=3'
    expect(parseLogLine(line, createLogEventCaches())).toEqual({
      label: 'WARN',
      cls: 'warn',
      text: 'Structure Wooden Foundation was destroyed at X=1 Y=2 Z=3',
      ts: '21:33:00'
    })
  })

  it('filters out purely technical engine noise', () => {
    const line = '[2026.07.27-21.34.00:000][109]Cleaning up expired peer connections'
    expect(parseLogLine(line, createLogEventCaches())).toBeNull()
  })

  it('returns null for a line that does not match the outer log line format at all', () => {
    expect(parseLogLine('not a real log line', createLogEventCaches())).toBeNull()
  })

  it('returns null for an empty line', () => {
    expect(parseLogLine('', createLogEventCaches())).toBeNull()
  })
})

describe('parseLogChunk', () => {
  it('parses every classifiable line in a multi-line chunk, in order, skipping the rest', () => {
    const chunk = [
      '[2026.07.27-21.00.00:000][1]Cleaning up expired peer connections',
      '[2026.07.27-21.25.23:191][991]2026.07.27_21.25.23: LeRaptorSauvage [UniqueNetId:0002dbe9ab20413e9b8e7e1562b76868 Platform:None] joined this ARK!',
      '[2026.07.27-21.25.35:084][345]2026.07.27_21.25.35: LeRaptorSauvage [UniqueNetId:0002dbe9ab20413e9b8e7e1562b76868 Platform:None] left this ARK!'
    ].join('\n')

    const events = parseLogChunk(chunk, createLogEventCaches())
    expect(events).toEqual([
      {
        label: 'JOIN',
        cls: 'join',
        text: `${hl('LeRaptorSauvage')} joined the server (ID: 0002dbe9ab20413e9b8e7e1562b76868)`,
        ts: '21:25:23'
      },
      { label: 'LEFT', cls: 'leave', text: `${hl('LeRaptorSauvage')} left the server`, ts: '21:25:35' }
    ])
  })
})
