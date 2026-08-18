import { describe, expect, it } from 'vitest'
import { isPidAlive, adoptPersistedProcesses, isRunning, getStatus, serverEvents } from '../src/main/lib/serverProcess'
import type { ServerProfile, ServerStatus } from '../shared/types'

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

describe('isPidAlive', () => {
  it('is true for the current process', () => {
    expect(isPidAlive(process.pid)).toBe(true)
  })

  it('is false for a pid that almost certainly does not exist', () => {
    expect(isPidAlive(999_999_999)).toBe(false)
  })
})

describe('adoptPersistedProcesses', () => {
  it('marks a profile as running when its persisted pid is still alive', () => {
    const profile = makeProfile('adopt-alive')
    adoptPersistedProcesses([profile], { [profile.id]: process.pid })

    expect(isRunning(profile.id)).toBe(true)
    expect(getStatus(profile.id)).toEqual({ profileId: profile.id, state: 'running', pid: process.pid })
  })

  it('leaves a profile stopped when its persisted pid is no longer alive', () => {
    const profile = makeProfile('adopt-dead')
    adoptPersistedProcesses([profile], { [profile.id]: 999_999_999 })

    expect(isRunning(profile.id)).toBe(false)
    expect(getStatus(profile.id)).toEqual({ profileId: profile.id, state: 'stopped' })
  })

  it('ignores profiles with no persisted pid', () => {
    const profile = makeProfile('adopt-none')
    adoptPersistedProcesses([profile], {})

    expect(isRunning(profile.id)).toBe(false)
  })

  it('carries over the persisted startedAt so uptime survives a Manager restart', () => {
    const profile = makeProfile('adopt-started-at')
    const startedAt = Date.now() - 60_000
    adoptPersistedProcesses([profile], { [profile.id]: process.pid }, { [profile.id]: startedAt })

    expect(getStatus(profile.id)).toEqual({ profileId: profile.id, state: 'running', pid: process.pid, startedAt })
  })

  it('has no startedAt when none was persisted for that profile', () => {
    const profile = makeProfile('adopt-no-started-at')
    adoptPersistedProcesses([profile], { [profile.id]: process.pid }, {})

    expect(getStatus(profile.id)).toEqual({ profileId: profile.id, state: 'running', pid: process.pid })
  })

  it('broadcasts the running status the same way a fresh start does, for anything listening', () => {
    const profile = makeProfile('adopt-emits')
    const received: ServerStatus[] = []
    const onStatus = (status: ServerStatus): void => {
      if (status.profileId === profile.id) received.push(status)
    }
    serverEvents.on('status', onStatus)
    try {
      adoptPersistedProcesses([profile], { [profile.id]: process.pid })
    } finally {
      serverEvents.off('status', onStatus)
    }
    expect(received).toEqual([{ profileId: profile.id, state: 'running', pid: process.pid }])
  })

  it('does not broadcast anything for a dead pid', () => {
    const profile = makeProfile('adopt-dead-no-emit')
    const received: ServerStatus[] = []
    const onStatus = (status: ServerStatus): void => {
      if (status.profileId === profile.id) received.push(status)
    }
    serverEvents.on('status', onStatus)
    try {
      adoptPersistedProcesses([profile], { [profile.id]: 999_999_999 })
    } finally {
      serverEvents.off('status', onStatus)
    }
    expect(received).toEqual([])
  })
})
