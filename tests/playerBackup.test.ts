import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerProfile } from '../shared/types'
import { backupPlayerProfile, sanitizeForFilename } from '../src/main/lib/playerBackup'
import type { PlayerConnectionEvent } from '../src/main/lib/playerConnectionWatcher'

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
    ...overrides
  }
}

describe('sanitizeForFilename', () => {
  it('strips characters unsafe in a Windows file name', () => {
    expect(sanitizeForFilename('Le<>:"/\\|?*Raptor')).toBe('Le_________Raptor')
  })

  it('falls back to "unknown" for a name that sanitizes to empty', () => {
    expect(sanitizeForFilename('   ')).toBe('unknown')
  })
})

describe('backupPlayerProfile', () => {
  let tmpDir: string
  let installDir: string
  let backupDir: string
  const uniqueNetId = '0002dbe9ab20413e9b8e7e1562b76868'

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-player-backup-test-'))
    installDir = path.join(tmpDir, 'install')
    backupDir = path.join(tmpDir, 'backups')
    const savedArksDir = path.join(installDir, 'ShooterGame', 'Saved', 'SavedArks', 'TheIsland_WP')
    fs.mkdirSync(savedArksDir, { recursive: true })
    fs.writeFileSync(path.join(savedArksDir, `${uniqueNetId}.arkprofile`), 'profile-data-v1')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('rejects when no backup directory is configured', async () => {
    const profile = makeProfile({ installDir, backupDir: '' })
    const event: PlayerConnectionEvent = { type: 'joined', playerName: 'LeRaptorSauvage', uniqueNetId }
    await expect(backupPlayerProfile(profile, event)).rejects.toThrow(/backup directory/)
  })

  it('copies the .arkprofile immediately on join', async () => {
    const profile = makeProfile({ installDir, backupDir })
    const event: PlayerConnectionEvent = { type: 'joined', playerName: 'LeRaptorSauvage', uniqueNetId }
    await backupPlayerProfile(profile, event)

    const destDir = path.join(backupDir, 'PlayerBackups', `LeRaptorSauvage_${uniqueNetId}`)
    const files = fs.readdirSync(destDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/_joined\.arkprofile$/)
    expect(fs.readFileSync(path.join(destDir, files[0]), 'utf-8')).toBe('profile-data-v1')
  })

  it('waits for the file to be rewritten before copying on leave', async () => {
    const profile = makeProfile({ installDir, backupDir })
    const sourcePath = path.join(installDir, 'ShooterGame', 'Saved', 'SavedArks', 'TheIsland_WP', `${uniqueNetId}.arkprofile`)
    const event: PlayerConnectionEvent = { type: 'left', playerName: 'LeRaptorSauvage', uniqueNetId }

    const backupPromise = backupPlayerProfile(profile, event)
    // Simulate ARK finishing its post-disconnect save shortly after the event fires.
    await new Promise((resolve) => setTimeout(resolve, 50))
    fs.writeFileSync(sourcePath, 'profile-data-v2')
    await backupPromise

    const destDir = path.join(backupDir, 'PlayerBackups', `LeRaptorSauvage_${uniqueNetId}`)
    const files = fs.readdirSync(destDir)
    expect(files[0]).toMatch(/_left\.arkprofile$/)
    expect(fs.readFileSync(path.join(destDir, files[0]), 'utf-8')).toBe('profile-data-v2')
  })

  it('prunes older backups beyond the per-player cap', async () => {
    const profile = makeProfile({ installDir, backupDir })
    const destDir = path.join(backupDir, 'PlayerBackups', `LeRaptorSauvage_${uniqueNetId}`)
    fs.mkdirSync(destDir, { recursive: true })
    for (let i = 0; i < 25; i++) {
      fs.writeFileSync(path.join(destDir, `existing-${i}.arkprofile`), 'old')
    }

    const event: PlayerConnectionEvent = { type: 'joined', playerName: 'LeRaptorSauvage', uniqueNetId }
    await backupPlayerProfile(profile, event)

    expect(fs.readdirSync(destDir).length).toBe(20)
  })
})
