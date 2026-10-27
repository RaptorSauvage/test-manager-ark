import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ServerProfile } from '../shared/types'

// Regression test for a real report: an escalating, self-reinforcing Manager freeze (a few
// seconds at first, then 15-20+ second blocks recurring every ~20s) traced to monitor.ts's
// setInterval firing a new tick every intervalMs regardless of whether the previous tick had
// finished - on Windows, getProcessStats spawns a fresh powershell.exe per tick, so once a
// single spawn was slow (antivirus scanning it, the system already under load right after a
// heavy server start), overlapping intervals piled up their own PowerShell spawns on top of
// still-running one(s) instead of just waiting. See monitor.ts's scheduleNextTick.
let concurrentCalls = 0
let maxConcurrentCalls = 0
const TICK_DELAY_MS = 30

vi.mock('pidusage', () => ({
  default: vi.fn(async () => {
    concurrentCalls += 1
    maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls)
    await new Promise((resolve) => setTimeout(resolve, TICK_DELAY_MS))
    concurrentCalls -= 1
    return { cpu: 12.34, memory: 512 * 1024 * 1024 }
  })
}))
vi.mock('../src/main/lib/rcon', () => ({ listPlayers: vi.fn(async () => []) }))
vi.mock('../src/main/lib/statsHistory', () => ({ recordStatSample: vi.fn() }))

import { adoptPersistedProcesses } from '../src/main/lib/serverProcess'
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
    clusterLogArchiveMaxSizeMB: 10,
    statsEnabled: false
  }
}

describe('monitor - no overlapping ticks', () => {
  beforeEach(() => {
    concurrentCalls = 0
    maxConcurrentCalls = 0
  })

  it('never has more than one getProcessStats call in flight at once, even when a tick runs longer than the interval', async () => {
    const profile = makeProfile('no-overlap')
    adoptPersistedProcesses([profile], { [profile.id]: process.pid })
    // Interval is much shorter than each tick's own delay (30ms) - a plain setInterval would
    // have fired several more ticks before the first one's pidusage call even resolved.
    startMonitoring(profile, 5)

    await new Promise((resolve) => setTimeout(resolve, 150))
    stopMonitoring(profile.id)

    expect(maxConcurrentCalls).toBe(1)
  })
})
