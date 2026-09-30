import { describe, expect, it } from 'vitest'
import { migrateMinecraftProfile } from '../src/main/lib/minecraftProfileMigration'
import type { MinecraftProfile } from '../shared/minecraft'

describe('migrateMinecraftProfile', () => {
  it('backfills every field added after Minecraft support first shipped', () => {
    // Simulates a profile as it actually exists on disk for anyone who imported/created one
    // before scheduledRestart*/serverType existed - cast through unknown since the stored
    // type lies about these being present.
    const legacy = {
      id: 'legacy-1',
      name: 'Old Server',
      installDir: '/srv/mc',
      launchMode: 'jar',
      jarFileName: 'server.jar',
      scriptFileName: '',
      minMemoryMB: 2048,
      maxMemoryMB: 4096,
      extraJvmArgs: '',
      extraProgramArgs: 'nogui',
      hidden: false,
      group: '',
      startOnManagerLaunch: false
    } as unknown as MinecraftProfile

    const migrated = migrateMinecraftProfile(legacy)

    expect(migrated.serverType).toBe('unknown')
    expect(migrated.scheduledRestartEnabled).toBe(false)
    expect(migrated.scheduledRestartTime).toBe('00:00')
    expect(migrated.scheduledRestartDays).toEqual([])
    expect(migrated.scheduledRestartStartAfter).toBe(true)
    expect(migrated.backupDir).toBe('')
    expect(migrated.maxBackups).toBe(10)
    expect(migrated.backupScheduleEnabled).toBe(false)
    // Untouched fields survive as-is.
    expect(migrated.name).toBe('Old Server')
    expect(migrated.jarFileName).toBe('server.jar')
  })

  it('leaves an already-current profile untouched', () => {
    const current: MinecraftProfile = {
      id: 'current-1',
      name: 'Current Server',
      serverType: 'paper',
      installDir: '/srv/mc',
      launchMode: 'jar',
      jarFileName: 'paper.jar',
      scriptFileName: '',
      minMemoryMB: 2048,
      maxMemoryMB: 4096,
      extraJvmArgs: '',
      extraProgramArgs: 'nogui',
      hidden: false,
      group: '',
      startOnManagerLaunch: false,
      scheduledRestartEnabled: true,
      scheduledRestartTime: '04:00',
      scheduledRestartDays: [1, 3, 5],
      scheduledRestartStartAfter: false,
      backupDir: '/srv/mc/backups',
      maxBackups: 5,
      backupScheduleEnabled: true
    }

    expect(migrateMinecraftProfile(current)).toEqual(current)
  })
})
