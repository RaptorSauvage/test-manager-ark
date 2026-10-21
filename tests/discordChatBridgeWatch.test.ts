import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ServerProfile } from '../shared/types'

const { calls } = vi.hoisted(() => ({ calls: [] as Array<{ channelId: string; kind: string; text: string }> }))
vi.mock('../src/main/lib/discordBot', () => ({
  notifyGameEvent: (channelId: string, kind: string, text: string) => calls.push({ channelId, kind, text })
}))

import { isTamedDinoKillEvent, routeGameEvent } from '../src/main/lib/discordChatBridgeWatch'

function makeProfile(overrides: Partial<ServerProfile> = {}): ServerProfile {
  return { id: 'bridge-test', name: 'Test', discordChatChannelId: '', discordEventsChannelId: '', ...overrides } as ServerProfile
}

describe('isTamedDinoKillEvent', () => {
  it('is true for a tamed dino death line (custom name + level)', () => {
    expect(isTamedDinoKillEvent('MyRex - Lvl 150 (Rex) was killed by Something!')).toBe(true)
  })

  it('is false for a wild-vs-wild death line (no level shown)', () => {
    expect(isTamedDinoKillEvent('Raptor_Character_BP_C (Raptor) was killed by a FemaleRaptor_Character_BP_C (Raptor)!')).toBe(
      false
    )
  })
})

describe('routeGameEvent', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('forwards CHAT to the chat channel when set', () => {
    const profile = makeProfile({ discordChatChannelId: 'chat-channel' })
    routeGameEvent(profile, { label: 'CHAT', cls: 'chat', text: 'Alice: hi', ts: '00:00:00' })
    expect(calls).toEqual([{ channelId: 'chat-channel', kind: 'chat', text: 'Alice: hi' }])
  })

  it('does not forward CHAT when no chat channel is set', () => {
    const profile = makeProfile()
    routeGameEvent(profile, { label: 'CHAT', cls: 'chat', text: 'Alice: hi', ts: '00:00:00' })
    expect(calls).toEqual([])
  })

  it('forwards TAME and MISSION to the events channel when set', () => {
    const profile = makeProfile({ discordEventsChannelId: 'events-channel' })
    routeGameEvent(profile, { label: 'TAME', cls: 'tame', text: 'Tamed a Rex!', ts: '00:00:00' })
    routeGameEvent(profile, { label: 'MISSION', cls: 'mission', text: 'Mission started: X — Y', ts: '00:00:00' })
    expect(calls).toEqual([
      { channelId: 'events-channel', kind: 'tame', text: 'Tamed a Rex!' },
      { channelId: 'events-channel', kind: 'mission', text: 'Mission started: X — Y' }
    ])
  })

  it('forwards a tamed-dino KILL but not a wild-vs-wild one', () => {
    const profile = makeProfile({ discordEventsChannelId: 'events-channel' })
    routeGameEvent(profile, { label: 'KILL', cls: 'kill', text: 'MyRex - Lvl 150 (Rex) was killed!', ts: '00:00:00' })
    routeGameEvent(profile, { label: 'KILL', cls: 'kill', text: 'Raptor_Character_BP_C (Raptor) was killed!', ts: '00:00:00' })
    expect(calls).toEqual([{ channelId: 'events-channel', kind: 'kill', text: 'MyRex - Lvl 150 (Rex) was killed!' }])
  })

  it('does not forward TAME/MISSION/KILL when no events channel is set', () => {
    const profile = makeProfile()
    routeGameEvent(profile, { label: 'TAME', cls: 'tame', text: 'Tamed a Rex!', ts: '00:00:00' })
    expect(calls).toEqual([])
  })

  it('never forwards unrelated labels (JOIN, WARN, SAVE, CMD, READY, CRYO)', () => {
    const profile = makeProfile({ discordChatChannelId: 'chat-channel', discordEventsChannelId: 'events-channel' })
    for (const label of ['JOIN', 'LEFT', 'WARN', 'SAVE', 'CMD', 'READY', 'CRYO'] as const) {
      routeGameEvent(profile, { label, cls: 'x', text: 'irrelevant', ts: '00:00:00' })
    }
    expect(calls).toEqual([])
  })
})
