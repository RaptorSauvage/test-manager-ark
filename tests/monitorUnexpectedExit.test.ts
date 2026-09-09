import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ServerProfile } from '../shared/types'

vi.mock('pidusage', () => ({ default: vi.fn() }))
vi.mock('../src/main/lib/rcon', () => ({
  sendRconCommand: vi.fn(),
  listPlayers: vi.fn(async () => [])
}))

import pidusage from 'pidusage'
import { sendRconCommand as mockSendRconCommand, listPlayers as mockListPlayers } from '../src/main/lib/rcon'
import { adoptPersistedProcesses, isRunning, isPidTracked, getStatus, emitStatus } from '../src/main/lib/serverProcess'
import { startMonitoring, stopMonitoring } from '../src/main/lib/monitor'

function makeProfile(id: string): ServerProfile {
  return {
    id,
    name: `Profile ${id}`,
    installDir: '/tmp/ark',
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
  vi.mocked(pidusage).mockReset()
  vi.mocked(mockSendRconCommand).mockReset()
  vi.mocked(mockListPlayers).mockReset().mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('monitor tick - pidusage failing (adopted process, or racing ahead of child.on(exit))', () => {
  it('drops pid tracking but keeps monitoring when RCON still confirms the server is alive', async () => {
    vi.useFakeTimers()
    vi.mocked(pidusage).mockRejectedValue(new Error('no such process'))
    vi.mocked(mockSendRconCommand).mockResolvedValue({ ok: true, response: 'x' })
    vi.mocked(mockListPlayers).mockResolvedValue(['Alice'])

    const profile = makeProfile('monitor-pidusage-handoff-alive')
    adoptPersistedProcesses([profile], { [profile.id]: process.pid })

    try {
      startMonitoring(profile, 10)
      await vi.advanceTimersByTimeAsync(50)

      expect(isRunning(profile.id)).toBe(true)
      expect(isPidTracked(profile.id)).toBe(false)
      expect(getStatus(profile.id).state).toBe('running')
      expect(getStatus(profile.id).players).toEqual(['Alice'])
    } finally {
      stopMonitoring(profile.id)
    }
  })

  it('surfaces the raw pidusage error on the status, so a persistent failure is diagnosable', async () => {
    vi.useFakeTimers()
    vi.mocked(pidusage).mockRejectedValue(new Error("'wmic' is not recognized as an internal or external command"))
    vi.mocked(mockSendRconCommand).mockResolvedValue({ ok: true, response: 'x' })

    const profile = makeProfile('monitor-pidusage-surfaces-error')
    adoptPersistedProcesses([profile], { [profile.id]: process.pid })

    try {
      startMonitoring(profile, 10)
      await vi.advanceTimersByTimeAsync(10)

      expect(getStatus(profile.id).statsError).toBe(
        "'wmic' is not recognized as an internal or external command"
      )
    } finally {
      stopMonitoring(profile.id)
    }
  })

  it('clears a previously surfaced stats error once a reading succeeds', async () => {
    vi.useFakeTimers()
    vi.mocked(pidusage).mockResolvedValue({ cpu: 4.2, memory: 256 * 1024 * 1024 })

    const profile = makeProfile('monitor-pidusage-error-clears')
    adoptPersistedProcesses([profile], { [profile.id]: process.pid })
    // Simulate a stats error left over from an earlier failure (e.g. a previous tick, or
    // carried over from adoption) - a fresh successful reading should wipe it, not just
    // silently leave it sitting alongside otherwise-current cpu/memory numbers.
    emitStatus({ ...getStatus(profile.id), statsError: 'stale error from before' })

    try {
      startMonitoring(profile, 10)
      await vi.advanceTimersByTimeAsync(10)

      expect(getStatus(profile.id).statsError).toBeUndefined()
      expect(getStatus(profile.id).cpu).toBe(4.2)
    } finally {
      stopMonitoring(profile.id)
    }
  })

  it('finalizes as stopped and stops monitoring when RCON does not answer either', async () => {
    vi.useFakeTimers()
    vi.mocked(pidusage).mockRejectedValue(new Error('no such process'))
    vi.mocked(mockSendRconCommand).mockResolvedValue({ ok: false, error: 'unreachable' })

    const profile = makeProfile('monitor-pidusage-dead')
    adoptPersistedProcesses([profile], { [profile.id]: process.pid })

    try {
      startMonitoring(profile, 50_000)
      await vi.advanceTimersByTimeAsync(60_000)

      expect(isRunning(profile.id)).toBe(false)
      expect(getStatus(profile.id)).toEqual({ profileId: profile.id, state: 'stopped' })
    } finally {
      stopMonitoring(profile.id)
    }
  })

  it('refreshes players on the very same tick that pidusage first fails, not a tick later', async () => {
    vi.useFakeTimers()
    // A large interval so exactly one tick fires within the window advanced below - proves
    // the player list updates within that single tick's own RCON re-verification, rather
    // than only catching up once pid tracking later settles into degraded polling.
    vi.mocked(pidusage).mockRejectedValue(new Error('no such process'))
    vi.mocked(mockSendRconCommand).mockResolvedValue({ ok: true, response: 'x' })
    vi.mocked(mockListPlayers).mockResolvedValue(['Carol'])

    const profile = makeProfile('monitor-pidusage-refresh-same-tick')
    adoptPersistedProcesses([profile], { [profile.id]: process.pid })

    try {
      startMonitoring(profile, 50_000)
      await vi.advanceTimersByTimeAsync(50_000)

      expect(isRunning(profile.id)).toBe(true)
      expect(getStatus(profile.id).players).toEqual(['Carol'])
    } finally {
      stopMonitoring(profile.id)
    }
  })
})

describe('monitor tick - already in degraded (pid-untracked) mode', () => {
  it('polls RCON instead of pidusage, and keeps updating players while it answers', async () => {
    vi.useFakeTimers()
    // First tick: pidusage fails, RCON confirms alive -> drops to degraded mode.
    // Second tick: already degraded, so it should go straight to the RCON branch below
    // without calling pidusage again.
    vi.mocked(pidusage).mockRejectedValue(new Error('no such process'))
    vi.mocked(mockSendRconCommand).mockResolvedValue({ ok: true, response: 'x' })
    vi.mocked(mockListPlayers).mockResolvedValue(['Bob'])

    const profile = makeProfile('monitor-degraded-alive')
    adoptPersistedProcesses([profile], { [profile.id]: process.pid })

    try {
      startMonitoring(profile, 10)
      await vi.advanceTimersByTimeAsync(10) // first tick: drops pid tracking
      expect(isPidTracked(profile.id)).toBe(false)
      const pidusageCallsSoFar = vi.mocked(pidusage).mock.calls.length

      await vi.advanceTimersByTimeAsync(10) // second tick: RCON-only branch

      expect(vi.mocked(pidusage).mock.calls.length).toBe(pidusageCallsSoFar)
      expect(isRunning(profile.id)).toBe(true)
      expect(getStatus(profile.id).players).toEqual(['Bob'])
    } finally {
      stopMonitoring(profile.id)
    }
  })

  it('finalizes as stopped and stops monitoring once RCON stops answering', async () => {
    vi.useFakeTimers()
    vi.mocked(pidusage).mockRejectedValue(new Error('no such process'))
    vi.mocked(mockSendRconCommand).mockResolvedValueOnce({ ok: true, response: 'x' })

    const profile = makeProfile('monitor-degraded-then-dead')
    adoptPersistedProcesses([profile], { [profile.id]: process.pid })

    try {
      startMonitoring(profile, 10)
      await vi.advanceTimersByTimeAsync(10) // first tick: drops pid tracking (RCON ok)
      expect(isPidTracked(profile.id)).toBe(false)

      vi.mocked(mockSendRconCommand).mockResolvedValue({ ok: false, error: 'unreachable' })
      await vi.advanceTimersByTimeAsync(10_000) // subsequent degraded-mode polls all fail

      expect(isRunning(profile.id)).toBe(false)
    } finally {
      stopMonitoring(profile.id)
    }
  })
})
