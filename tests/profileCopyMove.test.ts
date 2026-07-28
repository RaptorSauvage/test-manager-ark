import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { copyProfile, moveProfile } from '../src/main/lib/profileCopyMove'
import type { ServerProfile } from '../shared/types'

function makeProfile(overrides: Partial<ServerProfile> = {}): ServerProfile {
  return {
    id: 'test',
    name: 'Test',
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
    hidden: false,
    group: '',
    ...overrides
  }
}

describe('copyProfile / moveProfile', () => {
  let tmpDir: string
  let sourceDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-profile-copymove-test-'))
    sourceDir = path.join(tmpDir, 'source')
    fs.mkdirSync(path.join(sourceDir, 'ShooterGame', 'Saved'), { recursive: true })
    fs.writeFileSync(path.join(sourceDir, 'ShooterGame', 'Saved', 'marker.txt'), 'hello')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  describe('copyProfile', () => {
    it('duplicates every file into the destination as a new profile, leaving the original alone', async () => {
      const destDir = path.join(tmpDir, 'dest-copy')
      const profile = makeProfile({ id: 'orig-id', name: 'Original', installDir: sourceDir })

      const copied = await copyProfile(profile, destDir, 'Copy Of Original')

      expect(fs.readFileSync(path.join(destDir, 'ShooterGame', 'Saved', 'marker.txt'), 'utf-8')).toBe('hello')
      expect(fs.existsSync(path.join(sourceDir, 'ShooterGame', 'Saved', 'marker.txt'))).toBe(true)
      expect(copied.id).not.toBe('orig-id')
      expect(copied.name).toBe('Copy Of Original')
      expect(copied.installDir).toBe(destDir)
    })

    it('rejects a destination that already has files in it', async () => {
      const destDir = path.join(tmpDir, 'dest-nonempty')
      fs.mkdirSync(destDir, { recursive: true })
      fs.writeFileSync(path.join(destDir, 'already-here.txt'), 'x')
      const profile = makeProfile({ installDir: sourceDir })

      await expect(copyProfile(profile, destDir, 'New Name')).rejects.toThrow(/not empty/)
    })

    it('rejects copying onto the same install folder', async () => {
      const profile = makeProfile({ installDir: sourceDir })
      await expect(copyProfile(profile, sourceDir, 'New Name')).rejects.toThrow(/same as/)
    })

    it('rejects an empty destination path', async () => {
      const profile = makeProfile({ installDir: sourceDir })
      await expect(copyProfile(profile, '  ', 'New Name')).rejects.toThrow(/destination folder/i)
    })
  })

  describe('moveProfile', () => {
    it('relocates the files and updates the same profile in place', async () => {
      const destDir = path.join(tmpDir, 'dest-move')
      const profile = makeProfile({ id: 'orig-id', name: 'Original', installDir: sourceDir })

      const moved = await moveProfile(profile, destDir, 'Renamed')

      expect(fs.readFileSync(path.join(destDir, 'ShooterGame', 'Saved', 'marker.txt'), 'utf-8')).toBe('hello')
      expect(fs.existsSync(sourceDir)).toBe(false)
      expect(moved.id).toBe('orig-id')
      expect(moved.name).toBe('Renamed')
      expect(moved.installDir).toBe(destDir)
    })

    it('falls back to copy+remove when rename fails with EXDEV (cross-device move)', async () => {
      const destDir = path.join(tmpDir, 'dest-move-exdev')
      const profile = makeProfile({ installDir: sourceDir })

      const renameSpy = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(
        Object.assign(new Error('cross-device link'), { code: 'EXDEV' })
      )

      const moved = await moveProfile(profile, destDir, 'Renamed')

      expect(renameSpy).toHaveBeenCalled()
      expect(fs.readFileSync(path.join(destDir, 'ShooterGame', 'Saved', 'marker.txt'), 'utf-8')).toBe('hello')
      expect(fs.existsSync(sourceDir)).toBe(false)
      expect(moved.installDir).toBe(destDir)
    })

    it('rejects a destination that already has files in it', async () => {
      const destDir = path.join(tmpDir, 'dest-move-nonempty')
      fs.mkdirSync(destDir, { recursive: true })
      fs.writeFileSync(path.join(destDir, 'already-here.txt'), 'x')
      const profile = makeProfile({ installDir: sourceDir })

      await expect(moveProfile(profile, destDir, 'New Name')).rejects.toThrow(/not empty/)
    })
  })
})
