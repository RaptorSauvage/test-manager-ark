import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getPersistedMcStatusMessageId,
  getPersistedStatusMessageId,
  initStatusMessageState,
  setPersistedMcStatusMessageId,
  setPersistedStatusMessageId
} from '../src/bot/statusMessageState'

function tmpStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'discord-bot-status-message-test-'))
}

describe('statusMessageState', () => {
  it('starts with no persisted ids when there is nothing on disk yet', () => {
    initStatusMessageState(tmpStateDir())
    expect(getPersistedStatusMessageId()).toBeNull()
    expect(getPersistedMcStatusMessageId()).toBeNull()
  })

  it('survives a simulated bot restart (initStatusMessageState reloads from disk)', () => {
    const stateDir = tmpStateDir()
    initStatusMessageState(stateDir)

    setPersistedStatusMessageId('111')
    setPersistedMcStatusMessageId('222')
    expect(fs.existsSync(path.join(stateDir, 'status_messages.json'))).toBe(true)

    // Simulates a bot restart: a fresh process would call initStatusMessageState again,
    // which must reload what was persisted instead of starting from null - that's exactly
    // what used to cause the bot to post a brand new status message after every restart
    // (every Settings save restarts it) instead of finding and editing the real one.
    initStatusMessageState(stateDir)
    expect(getPersistedStatusMessageId()).toBe('111')
    expect(getPersistedMcStatusMessageId()).toBe('222')
  })

  it('tracks the ARK and Minecraft message ids independently', () => {
    const stateDir = tmpStateDir()
    initStatusMessageState(stateDir)

    setPersistedStatusMessageId('ark-id')
    expect(getPersistedStatusMessageId()).toBe('ark-id')
    expect(getPersistedMcStatusMessageId()).toBeNull()

    setPersistedMcStatusMessageId('mc-id')
    expect(getPersistedMcStatusMessageId()).toBe('mc-id')
    expect(getPersistedStatusMessageId()).toBe('ark-id')
  })

  it('clearing one id to null persists that and leaves the other alone', () => {
    const stateDir = tmpStateDir()
    initStatusMessageState(stateDir)
    setPersistedStatusMessageId('ark-id')
    setPersistedMcStatusMessageId('mc-id')

    setPersistedStatusMessageId(null)
    initStatusMessageState(stateDir)
    expect(getPersistedStatusMessageId()).toBeNull()
    expect(getPersistedMcStatusMessageId()).toBe('mc-id')
  })

  it('ignores a malformed state file instead of crashing', () => {
    const stateDir = tmpStateDir()
    fs.writeFileSync(path.join(stateDir, 'status_messages.json'), '{not valid json', 'utf-8')
    expect(() => initStatusMessageState(stateDir)).not.toThrow()
    expect(getPersistedStatusMessageId()).toBeNull()
    expect(getPersistedMcStatusMessageId()).toBeNull()
  })

  it('switching to a different stateDir starts fresh instead of leaking the previous one', () => {
    const stateDirA = tmpStateDir()
    initStatusMessageState(stateDirA)
    setPersistedStatusMessageId('from-a')

    const stateDirB = tmpStateDir()
    initStatusMessageState(stateDirB)
    expect(getPersistedStatusMessageId()).toBeNull()
  })
})
