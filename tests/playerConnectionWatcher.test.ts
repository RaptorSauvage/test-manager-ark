import { describe, expect, it } from 'vitest'
import { parsePlayerConnectionEvents } from '../src/main/lib/playerConnectionWatcher'

const JOIN_LINE =
  '[2026.07.27-21.25.23:191][991]2026.07.27_21.25.23: LeRaptorSauvage [UniqueNetId:0002dbe9ab20413e9b8e7e1562b76868 Platform:None] joined this ARK!'
const LEAVE_LINE =
  '[2026.07.27-21.25.35:084][345]2026.07.27_21.25.35: LeRaptorSauvage [UniqueNetId:0002dbe9ab20413e9b8e7e1562b76868 Platform:None] left this ARK!'

describe('parsePlayerConnectionEvents', () => {
  it('parses a join line from the real ShooterGame.log format', () => {
    expect(parsePlayerConnectionEvents(JOIN_LINE)).toEqual([
      { type: 'joined', playerName: 'LeRaptorSauvage', uniqueNetId: '0002dbe9ab20413e9b8e7e1562b76868' }
    ])
  })

  it('parses a leave line', () => {
    expect(parsePlayerConnectionEvents(LEAVE_LINE)).toEqual([
      { type: 'left', playerName: 'LeRaptorSauvage', uniqueNetId: '0002dbe9ab20413e9b8e7e1562b76868' }
    ])
  })

  it('parses multiple events out of one multi-line chunk, ignoring unrelated lines', () => {
    const chunk = [
      '[2026.07.27-21.00.00:000][1]2026.07.27_21.00.00: Loading map TheIsland_WP...',
      JOIN_LINE,
      'Some other log line entirely',
      LEAVE_LINE
    ].join('\n')

    expect(parsePlayerConnectionEvents(chunk)).toEqual([
      { type: 'joined', playerName: 'LeRaptorSauvage', uniqueNetId: '0002dbe9ab20413e9b8e7e1562b76868' },
      { type: 'left', playerName: 'LeRaptorSauvage', uniqueNetId: '0002dbe9ab20413e9b8e7e1562b76868' }
    ])
  })

  it('lowercases the uniqueNetId in case of mixed-case hex', () => {
    const line = JOIN_LINE.replace('0002dbe9ab20413e9b8e7e1562b76868', '0002DBE9AB20413E9B8E7E1562B76868')
    expect(parsePlayerConnectionEvents(line)).toEqual([
      { type: 'joined', playerName: 'LeRaptorSauvage', uniqueNetId: '0002dbe9ab20413e9b8e7e1562b76868' }
    ])
  })

  it('returns an empty array when nothing matches', () => {
    expect(parsePlayerConnectionEvents('nothing interesting here\nor here')).toEqual([])
  })
})
