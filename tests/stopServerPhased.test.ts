import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ServerProfile } from '../shared/types'

class FakeChildProcess extends EventEmitter {
  pid = 4242
  unref = vi.fn()
  kill = vi.fn(() => {
    this.emit('exit')
  })
}

/** kill() here does nothing at all - no 'exit' ever fires - standing in for the real-world
 *  gap between a kill signal being sent and the OS/Node actually confirming the process is
 *  gone (FakeChildProcess's synchronous emit above glosses over that entirely). Exercises
 *  waitForExitOrKill's isPidAlive poll fallback, the only thing that still notices this pid
 *  (never a real OS process in this test environment, so isPidAlive reports it gone
 *  immediately either way) is actually gone. */
class FakeChildProcessNeverExits extends EventEmitter {
  pid = 4242
  unref = vi.fn()
  kill = vi.fn()
}

const { getFakeChild, setFakeChild } = vi.hoisted(() => {
  let current: FakeChildProcess | FakeChildProcessNeverExits | undefined
  return {
    getFakeChild: () => current,
    setFakeChild: (child: FakeChildProcess | FakeChildProcessNeverExits) => {
      current = child
    }
  }
})

vi.mock('../src/main/lib/rcon', () => ({ sendRconCommand: vi.fn(async () => ({ ok: true, response: 'World Saved' })) }))
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => getFakeChild()), exec: vi.fn() }))

import { startServer, stopServerPhased, __resetServerSpawnQueueForTests } from '../src/main/lib/serverProcess'
import { sendRconCommand as mockSendRconCommand } from '../src/main/lib/rcon'
import { spawn as mockSpawn } from 'node:child_process'

function makeProfile(id: string): ServerProfile {
  return {
    id,
    name: `Profile ${id}`,
    installDir: '/tmp/ark-stop-test',
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
    game: 'ark-ascended',
    maxDinoLevel: '',
    serverPassword: '',
    autoManageMods: false,
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
    group: '',
    crashWatchEnabled: false,
    zombieDetectionEnabled: false,
    zombieDetectionTimeoutMinutes: 10,
    zombieDetectionAutoRestart: false,
    clusterLogArchiveMaxSizeMB: 10
  }
}

describe('stopServerPhased', () => {
  beforeEach(() => {
    setFakeChild(new FakeChildProcess())
    vi.mocked(mockSendRconCommand).mockReset().mockResolvedValue({ ok: true, response: 'World Saved' })
    __resetServerSpawnQueueForTests()
  })

  it('waits saveSettleMs after a confirmed SaveWorld before sending DoExit', async () => {
    const profile = makeProfile('stop-settle')
    startServer(profile)

    const { finished } = stopServerPhased(profile, 200, 'stopping', 50)

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mockSendRconCommand).toHaveBeenCalledWith(profile, 'SaveWorld')
    expect(mockSendRconCommand).not.toHaveBeenCalledWith(profile, 'DoExit')

    await finished
    expect(mockSendRconCommand).toHaveBeenCalledWith(profile, 'DoExit')
  })

  it('resolves saved right after SaveWorld confirms, without waiting for the settle delay', async () => {
    const profile = makeProfile('stop-saved-fast')
    startServer(profile)

    const start = Date.now()
    const { saved, finished } = stopServerPhased(profile, 200, 'stopping', 200)

    expect(await saved).toBe(true)
    expect(Date.now() - start).toBeLessThan(150)

    await finished
  })

  it('never sends DoExit when SaveWorld does not confirm', async () => {
    vi.mocked(mockSendRconCommand).mockResolvedValue({ ok: false, error: 'RCON unreachable' })
    const profile = makeProfile('stop-no-confirm')
    startServer(profile)

    const { saved, finished } = stopServerPhased(profile, 50, 'stopping', 50)

    expect(await saved).toBe(false)
    await finished
    expect(mockSendRconCommand).not.toHaveBeenCalledWith(profile, 'DoExit')
  })

  it('actually clears the running entry after a forced kill, so a chained startServer() spawns a fresh process instead of silently no-oping', async () => {
    // Regression test for a real report: a scheduled Event Scheduler mod-activation event
    // (shutdownOnStart) added a mod to the profile and "restarted" the server per the
    // Manager, but the mod was never actually loaded - traced to waitForExitOrKill firing a
    // force-kill and returning immediately, before the process was actually confirmed gone,
    // so the chained startServer() call right after found `running` still holding the old
    // entry and no-op'd instead of spawning a new process with the updated mod list. Uses
    // FakeChildProcessNeverExits (kill() that never emits 'exit') to exercise the worst case -
    // only the isPidAlive poll fallback notices this pid is actually gone.
    vi.mocked(mockSendRconCommand).mockResolvedValue({ ok: false, error: 'RCON unreachable' })
    const neverExits = new FakeChildProcessNeverExits()
    setFakeChild(neverExits)
    const profile = makeProfile('stop-force-kill-restart')
    startServer(profile)
    const spawnsAfterFirstStart = vi.mocked(mockSpawn).mock.calls.length

    const { finished } = stopServerPhased(profile, 50, 'stopping', 50)
    await finished
    expect(neverExits.kill).toHaveBeenCalled()

    setFakeChild(new FakeChildProcess())
    // Unrelated to the bug under test - reset so the spawn-stagger queue (reserveSpawnSlot,
    // see its own doc comment) doesn't queue this second start for later just because it
    // follows the first one in quick succession within this one test.
    __resetServerSpawnQueueForTests()
    startServer(profile)
    expect(vi.mocked(mockSpawn).mock.calls.length).toBe(spawnsAfterFirstStart + 1)
  })
})
