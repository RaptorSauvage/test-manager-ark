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

const { getFakeChild, setFakeChild } = vi.hoisted(() => {
  let current: FakeChildProcess | undefined
  return {
    getFakeChild: () => current,
    setFakeChild: (child: FakeChildProcess) => {
      current = child
    }
  }
})

vi.mock('../src/main/lib/rcon', () => ({ sendRconCommand: vi.fn(async () => ({ ok: true, response: 'World Saved' })) }))
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => getFakeChild()) }))

import { startServer, stopServerPhased } from '../src/main/lib/serverProcess'
import { sendRconCommand as mockSendRconCommand } from '../src/main/lib/rcon'

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

describe('stopServerPhased', () => {
  beforeEach(() => {
    setFakeChild(new FakeChildProcess())
    vi.mocked(mockSendRconCommand).mockReset().mockResolvedValue({ ok: true, response: 'World Saved' })
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
})
