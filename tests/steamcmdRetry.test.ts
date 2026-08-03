import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import type { ServerProfile } from '../shared/types'

// updateServer's log file lives under getDataDir(), which normally goes through
// electron-store/Electron's app.getPath - neither available in this Node test
// environment. Redirecting it to a plain temp dir sidesteps that entirely.
const { dataDir } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('node:os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('node:path')
  return { dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ark-steamcmd-retry-')) }
})
vi.mock('../src/main/lib/dataDir', () => ({ getDataDir: () => dataDir }))

const { queueExitCodes, nextExitCode, spawnCallCount, resetSpawnCallCount } = vi.hoisted(() => {
  let codes: number[] = []
  let calls = 0
  return {
    queueExitCodes: (c: number[]) => {
      codes = [...c]
    },
    nextExitCode: (): number => {
      calls++
      return codes.shift() ?? 0
    },
    spawnCallCount: (): number => calls,
    resetSpawnCallCount: () => {
      calls = 0
      codes = []
    }
  }
})

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & { pid: number }
    child.pid = 1234
    const code = nextExitCode()
    setImmediate(() => child.emit('close', code))
    return child
  })
}))

import { updateServer, steamcmdUpdateEvents } from '../src/main/lib/steamcmd'

function makeProfile(overrides: Partial<ServerProfile> = {}): ServerProfile {
  return {
    id: 'retry-test',
    name: 'Test',
    installDir: path.join(dataDir, 'install'),
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
    hidden: false,
    group: '',
    ...overrides
  }
}

describe('updateServer retry', () => {
  let steamCmdPath: string

  beforeEach(() => {
    resetSpawnCallCount()
    steamCmdPath = path.join(dataDir, `steamcmd-${Math.random()}.exe`)
    fs.writeFileSync(steamCmdPath, '')
  })

  afterEach(() => {
    fs.rmSync(steamCmdPath, { force: true })
  })

  it('succeeds on the first attempt without retrying', async () => {
    queueExitCodes([0])
    const profile = makeProfile({ id: 'retry-first-try' })

    await updateServer(profile, steamCmdPath)

    expect(spawnCallCount()).toBe(1)
  })

  it('retries after a failed attempt and succeeds once a later one does', async () => {
    queueExitCodes([1, 1, 0])
    const profile = makeProfile({ id: 'retry-eventual-success' })

    await updateServer(profile, steamCmdPath)

    expect(spawnCallCount()).toBe(3)
  })

  it('gives up after 3 failed attempts and reports a clear error', async () => {
    queueExitCodes([1, 1, 1])
    const profile = makeProfile({ id: 'retry-exhausted' })

    await expect(updateServer(profile, steamCmdPath)).rejects.toThrow('SteamCMD failed after 3 attempts')
    expect(spawnCallCount()).toBe(3)
  })

  it('emits a live log event for the retrying profile so the UI can refresh without polling', async () => {
    queueExitCodes([1, 0])
    const profile = makeProfile({ id: 'retry-live-events' })
    const seenProfileIds: string[] = []
    const onLog = (profileId: string): void => {
      seenProfileIds.push(profileId)
    }
    steamcmdUpdateEvents.on('log', onLog)

    try {
      await updateServer(profile, steamCmdPath)
    } finally {
      steamcmdUpdateEvents.off('log', onLog)
    }

    expect(seenProfileIds.length).toBeGreaterThan(0)
    expect(seenProfileIds.every((id) => id === profile.id)).toBe(true)
  })
})
