import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ServerProfile } from '../shared/types'

class FakeChildProcess extends EventEmitter {
  pid = 4242
  unref = vi.fn()
  kill = vi.fn(() => {
    this.emit('exit')
  })
}

const { getFakeChild, setFakeChild } = vi.hoisted(() => {
  let current: FakeChildProcess | undefined
  return {
    getFakeChild: () => current,
    setFakeChild: (child: FakeChildProcess) => {
      current = child
    }
  }
})

vi.mock('../src/main/lib/rcon', () => ({ sendRconCommand: vi.fn(async () => ({ ok: true, response: 'x' })) }))
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => getFakeChild()) }))

import {
  startServer,
  isRunning,
  isPidTracked,
  getStatus,
  emitStatus,
  confirmAliveViaRcon,
  handleUnexpectedExit
} from '../src/main/lib/serverProcess'
import { sendRconCommand as mockSendRconCommand } from '../src/main/lib/rcon'

function makeProfile(id: string): ServerProfile {
  return {
    id,
    name: `Profile ${id}`,
    installDir: '/tmp/ark-unexpected-exit-test',
    map: 'TheIsland_WP',
    moddedMapEnabled: false,
    moddedMapId: '',
    gamePort: 7777,
    rconPort: 27020,
    serverPlatform: 'PC',
    maxPlayers: 70,
    backupDir: '',
    maxBackups: 10,
    backupScheduleEnabled: false,
    playerProfileBackupEnabled: false,
    playerProfileBackupMaxPerPlayer: 20,
    mods: [],
    clusterEnabled: false,
    clusterId: '',
    clusterDirOverride: '',
    noTransferFromFiltering: false,
    externalIp: '',
    cultureSettings: 'none',
    disableBattlEye: false,
    rconTribeLog: false,
    forceRespawnDinos: false,
    noSound: false,
    extraArgs: '',
    scheduledRestartEnabled: false,
    scheduledRestartTime: '00:00',
    scheduledRestartDays: [],
    scheduledRestartUpdateAfter: false,
    scheduledRestartStartAfter: false,
    scheduledDinoWipeEnabled: false,
    scheduledDinoWipeTime: '00:00',
    scheduledDinoWipeDays: [],
    startOnManagerLaunch: false,
    hidden: false,
    group: ''
  }
}

beforeEach(() => {
  setFakeChild(new FakeChildProcess())
  vi.mocked(mockSendRconCommand).mockReset()
})

describe('isPidTracked', () => {
  it('reports true for a profile with no running entry at all (nothing to distrust)', () => {
    expect(isPidTracked('no-such-profile')).toBe(true)
  })

  it('reports true right after a fresh start', () => {
    const profile = makeProfile('pid-tracked-fresh-start')
    startServer(profile)
    expect(isPidTracked(profile.id)).toBe(true)
  })
})

describe('confirmAliveViaRcon', () => {
  it('resolves true on the first successful round-trip, without retrying', async () => {
    vi.mocked(mockSendRconCommand).mockResolvedValue({ ok: true, response: 'x' })
    const profile = makeProfile('confirm-alive-first-try')

    await expect(confirmAliveViaRcon(profile, 3, 1)).resolves.toBe(true)
    expect(mockSendRconCommand).toHaveBeenCalledTimes(1)
    expect(mockSendRconCommand).toHaveBeenCalledWith(profile, 'ListPlayers')
  })

  it('retries after a failed attempt and succeeds on a later one', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(mockSendRconCommand)
        .mockResolvedValueOnce({ ok: false, error: 'unreachable' })
        .mockResolvedValueOnce({ ok: true, response: 'x' })
      const profile = makeProfile('confirm-alive-retry-then-ok')

      const result = confirmAliveViaRcon(profile, 3, 2000)
      await vi.advanceTimersByTimeAsync(2000)

      await expect(result).resolves.toBe(true)
      expect(mockSendRconCommand).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves false once every attempt has failed', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(mockSendRconCommand).mockResolvedValue({ ok: false, error: 'unreachable' })
      const profile = makeProfile('confirm-alive-all-fail')

      const result = confirmAliveViaRcon(profile, 3, 2000)
      await vi.advanceTimersByTimeAsync(4000)

      await expect(result).resolves.toBe(false)
      expect(mockSendRconCommand).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('handleUnexpectedExit', () => {
  it('does nothing for a profile that has no running entry', async () => {
    vi.mocked(mockSendRconCommand).mockResolvedValue({ ok: true, response: 'x' })
    const profile = makeProfile('handoff-not-running')

    await handleUnexpectedExit(profile)

    expect(isRunning(profile.id)).toBe(false)
    expect(mockSendRconCommand).not.toHaveBeenCalled()
  })

  it('keeps the profile running, with pid tracking dropped, when RCON still answers', async () => {
    vi.mocked(mockSendRconCommand).mockResolvedValue({ ok: true, response: 'x' })
    const profile = makeProfile('handoff-alive')
    startServer(profile)
    emitStatus({ ...getStatus(profile.id), state: 'running' })

    await handleUnexpectedExit(profile)

    expect(isRunning(profile.id)).toBe(true)
    expect(isPidTracked(profile.id)).toBe(false)
    expect(getStatus(profile.id).state).toBe('running')
  })

  it('finalizes as stopped when RCON does not answer either', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(mockSendRconCommand).mockResolvedValue({ ok: false, error: 'unreachable' })
      const profile = makeProfile('handoff-dead')
      startServer(profile)
      emitStatus({ ...getStatus(profile.id), state: 'running' })

      const finished = handleUnexpectedExit(profile)
      await vi.advanceTimersByTimeAsync(10_000)
      await finished

      expect(isRunning(profile.id)).toBe(false)
      expect(getStatus(profile.id)).toEqual({ profileId: profile.id, state: 'stopped' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('child.on(exit) - expected vs. unexpected exits', () => {
  it('finalizes immediately as stopped for an exit while already stopping, without checking RCON', () => {
    vi.mocked(mockSendRconCommand).mockResolvedValue({ ok: true, response: 'x' })
    const profile = makeProfile('exit-expected-stopping')
    startServer(profile)
    emitStatus({ profileId: profile.id, state: 'stopping' })

    getFakeChild()!.emit('exit')

    expect(isRunning(profile.id)).toBe(false)
    expect(getStatus(profile.id)).toEqual({ profileId: profile.id, state: 'stopped' })
    expect(mockSendRconCommand).not.toHaveBeenCalled()
  })

  it('finalizes immediately as stopped for an exit while already restarting, without checking RCON', () => {
    vi.mocked(mockSendRconCommand).mockResolvedValue({ ok: true, response: 'x' })
    const profile = makeProfile('exit-expected-restarting')
    startServer(profile)
    emitStatus({ profileId: profile.id, state: 'restarting' })

    getFakeChild()!.emit('exit')

    expect(isRunning(profile.id)).toBe(false)
    expect(mockSendRconCommand).not.toHaveBeenCalled()
  })

  it('an exit while running is unexpected - checks RCON first, and keeps monitoring if it still answers', async () => {
    vi.mocked(mockSendRconCommand).mockResolvedValue({ ok: true, response: 'x' })
    const profile = makeProfile('exit-unexpected-alive')
    startServer(profile)
    emitStatus({ ...getStatus(profile.id), state: 'running' })

    getFakeChild()!.emit('exit')
    // handleUnexpectedExit is fired-and-forgotten (void) from the exit handler - give its
    // microtasks a turn before asserting.
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(isRunning(profile.id)).toBe(true)
    expect(isPidTracked(profile.id)).toBe(false)
  })

  it('an exit while still starting is also unexpected and finalizes as stopped once RCON fails too', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(mockSendRconCommand).mockResolvedValue({ ok: false, error: 'unreachable' })
      const profile = makeProfile('exit-unexpected-dead')
      startServer(profile)
      // startServer leaves the status as 'starting' until the log marker/fallback fires.

      getFakeChild()!.emit('exit')
      await vi.advanceTimersByTimeAsync(10_000)

      expect(isRunning(profile.id)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
