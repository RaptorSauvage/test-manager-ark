import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerProfile, ServerStatus } from '../shared/types'
import {
  setConfigFilesReadOnly,
  scheduleConfigFilesReadOnly,
  handleStatusForIniLock,
  unlockStoppedProfilesOnStartup,
  applyIniLockSetting
} from '../src/main/lib/iniLock'

const TEST_INSTALL_DIR = path.join(os.tmpdir(), `ini-lock-test-${process.pid}`)
const CONFIG_DIR = path.join(TEST_INSTALL_DIR, 'ShooterGame', 'Saved', 'Config', 'WindowsServer')
const GAME_USER_SETTINGS = path.join(CONFIG_DIR, 'GameUserSettings.ini')
const GAME_INI = path.join(CONFIG_DIR, 'Game.ini')

function isWritable(file: string): boolean {
  return (fs.statSync(file).mode & 0o200) !== 0
}

describe('setConfigFilesReadOnly', () => {
  beforeEach(() => {
    fs.rmSync(TEST_INSTALL_DIR, { recursive: true, force: true })
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    fs.writeFileSync(GAME_USER_SETTINGS, '[ServerSettings]\n')
    fs.writeFileSync(GAME_INI, '[/script/shootergame.shootergamemode]\n')
  })

  afterEach(() => {
    fs.rmSync(TEST_INSTALL_DIR, { recursive: true, force: true })
  })

  it('makes both ini files read-only', async () => {
    await setConfigFilesReadOnly(TEST_INSTALL_DIR, true)
    expect(isWritable(GAME_USER_SETTINGS)).toBe(false)
    expect(isWritable(GAME_INI)).toBe(false)
  })

  it('restores both ini files to writable', async () => {
    await setConfigFilesReadOnly(TEST_INSTALL_DIR, true)
    await setConfigFilesReadOnly(TEST_INSTALL_DIR, false)
    expect(isWritable(GAME_USER_SETTINGS)).toBe(true)
    expect(isWritable(GAME_INI)).toBe(true)
  })

  it('does not throw when the config folder does not exist yet', async () => {
    fs.rmSync(TEST_INSTALL_DIR, { recursive: true, force: true })
    await expect(setConfigFilesReadOnly(TEST_INSTALL_DIR, true)).resolves.toBeUndefined()
  })
})

describe('scheduleConfigFilesReadOnly', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('applies the change after the delay', async () => {
    const apply = vi.fn().mockResolvedValue(undefined)
    scheduleConfigFilesReadOnly('profile-1', '/install/dir', true, apply, 5000)
    expect(apply).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5000)
    expect(apply).toHaveBeenCalledWith('/install/dir', true)
  })

  it('cancels a pending change and only applies the latest one for the same profile', async () => {
    const apply = vi.fn().mockResolvedValue(undefined)
    scheduleConfigFilesReadOnly('profile-1', '/install/dir', true, apply, 5000)
    await vi.advanceTimersByTimeAsync(2000)
    scheduleConfigFilesReadOnly('profile-1', '/install/dir', false, apply, 5000)
    await vi.advanceTimersByTimeAsync(5000)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith('/install/dir', false)
  })

  it('debounces independently per profile', async () => {
    const apply = vi.fn().mockResolvedValue(undefined)
    scheduleConfigFilesReadOnly('profile-1', '/install/a', true, apply, 5000)
    scheduleConfigFilesReadOnly('profile-2', '/install/b', true, apply, 5000)
    await vi.advanceTimersByTimeAsync(5000)
    expect(apply).toHaveBeenCalledTimes(2)
    expect(apply).toHaveBeenCalledWith('/install/a', true)
    expect(apply).toHaveBeenCalledWith('/install/b', true)
  })
})

function makeStatus(overrides: Partial<ServerStatus>): ServerStatus {
  return { profileId: 'profile-1', state: 'running', ...overrides }
}

describe('handleStatusForIniLock', () => {
  it('schedules a lock when the server becomes running', () => {
    const lookupProfile = vi.fn().mockReturnValue({ id: 'profile-1', installDir: '/install/dir' })
    const schedule = vi.fn()
    handleStatusForIniLock(makeStatus({ state: 'running' }), lookupProfile, schedule, () => true)
    expect(schedule).toHaveBeenCalledWith('profile-1', '/install/dir', true)
  })

  it('schedules an unlock when the server becomes stopped', () => {
    const lookupProfile = vi.fn().mockReturnValue({ id: 'profile-1', installDir: '/install/dir' })
    const schedule = vi.fn()
    handleStatusForIniLock(makeStatus({ state: 'stopped' }), lookupProfile, schedule, () => true)
    expect(schedule).toHaveBeenCalledWith('profile-1', '/install/dir', false)
  })

  it('ignores intermediate states like starting/stopping/updating', () => {
    const lookupProfile = vi.fn().mockReturnValue({ id: 'profile-1', installDir: '/install/dir' })
    const schedule = vi.fn()
    for (const state of ['starting', 'stopping', 'updating', 'restarting', 'error'] as const) {
      handleStatusForIniLock(makeStatus({ state }), lookupProfile, schedule, () => true)
    }
    expect(schedule).not.toHaveBeenCalled()
  })

  it('does nothing for an unknown profile', () => {
    const lookupProfile = vi.fn().mockReturnValue(undefined)
    const schedule = vi.fn()
    handleStatusForIniLock(makeStatus({ state: 'running' }), lookupProfile, schedule, () => true)
    expect(schedule).not.toHaveBeenCalled()
  })

  it('does nothing when the feature is disabled in settings', () => {
    const lookupProfile = vi.fn().mockReturnValue({ id: 'profile-1', installDir: '/install/dir' })
    const schedule = vi.fn()
    handleStatusForIniLock(makeStatus({ state: 'running' }), lookupProfile, schedule, () => false)
    expect(schedule).not.toHaveBeenCalled()
    expect(lookupProfile).not.toHaveBeenCalled()
  })
})

describe('unlockStoppedProfilesOnStartup', () => {
  it('unlocks every profile that is not currently running', () => {
    const apply = vi.fn().mockResolvedValue(undefined)
    const profiles = [
      { id: 'a', installDir: '/install/a' } as ServerProfile,
      { id: 'b', installDir: '/install/b' } as ServerProfile
    ]
    const isRunning = (id: string): boolean => id === 'a'
    unlockStoppedProfilesOnStartup(profiles, isRunning, apply)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith('/install/b', false)
  })
})

describe('applyIniLockSetting', () => {
  const profiles = [
    { id: 'a', installDir: '/install/a' } as ServerProfile,
    { id: 'b', installDir: '/install/b' } as ServerProfile
  ]

  it('does nothing when the setting is enabled', () => {
    const apply = vi.fn().mockResolvedValue(undefined)
    applyIniLockSetting(true, profiles, apply)
    expect(apply).not.toHaveBeenCalled()
  })

  it('unlocks every profile, running or not, when the setting is disabled', () => {
    const apply = vi.fn().mockResolvedValue(undefined)
    applyIniLockSetting(false, profiles, apply)
    expect(apply).toHaveBeenCalledTimes(2)
    expect(apply).toHaveBeenCalledWith('/install/a', false)
    expect(apply).toHaveBeenCalledWith('/install/b', false)
  })

  it('cancels a pending scheduled change for a profile it unlocks', async () => {
    vi.useFakeTimers()
    const scheduleApply = vi.fn().mockResolvedValue(undefined)
    scheduleConfigFilesReadOnly('a', '/install/a', true, scheduleApply, 5000)
    const unlockApply = vi.fn().mockResolvedValue(undefined)
    applyIniLockSetting(false, [{ id: 'a', installDir: '/install/a' } as ServerProfile], unlockApply)
    await vi.advanceTimersByTimeAsync(5000)
    expect(scheduleApply).not.toHaveBeenCalled()
    expect(unlockApply).toHaveBeenCalledWith('/install/a', false)
    vi.useRealTimers()
  })
})
