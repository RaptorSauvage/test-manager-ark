import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { createBackup, isIgnoredBackupFile, selectBackupsToPrune } from '../src/main/lib/backup'
import type { BackupEntry, ServerProfile } from '../shared/types'

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
    ...overrides
  }
}

function entry(fileName: string, createdAt: number): BackupEntry {
  return { fileName, filePath: `/backups/${fileName}`, createdAt, sizeBytes: 1024 }
}

describe('selectBackupsToPrune', () => {
  it('keeps the newest N backups and prunes the rest', () => {
    const backups = [entry('a', 1), entry('b', 3), entry('c', 2), entry('d', 4)]
    const toPrune = selectBackupsToPrune(backups, 2)
    expect(toPrune.map((b) => b.fileName)).toEqual(['c', 'a'])
  })

  it('prunes nothing when under the limit', () => {
    const backups = [entry('a', 1), entry('b', 2)]
    expect(selectBackupsToPrune(backups, 5)).toEqual([])
  })

  it('treats a non-positive maxBackups as "no limit" and prunes nothing', () => {
    const backups = [entry('a', 1)]
    expect(selectBackupsToPrune(backups, 0)).toEqual([])
    expect(selectBackupsToPrune(backups, -1)).toEqual([])
  })
})

describe('isIgnoredBackupFile', () => {
  it('ignores .arkrbf files regardless of case', () => {
    expect(isIgnoredBackupFile('TheIsland.ark.arkrbf')).toBe(true)
    expect(isIgnoredBackupFile('TheIsland.ark.ARKRBF')).toBe(true)
  })

  it('does not ignore other save files', () => {
    expect(isIgnoredBackupFile('TheIsland.ark')).toBe(false)
    expect(isIgnoredBackupFile('0002dbe9ab20413e9b8e7e1562b76868.arkprofile')).toBe(false)
  })
})

describe('createBackup', () => {
  let tmpDir: string
  let installDir: string
  let backupDir: string
  let savedArksDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-backup-test-'))
    installDir = path.join(tmpDir, 'install')
    backupDir = path.join(tmpDir, 'backups')
    savedArksDir = path.join(installDir, 'ShooterGame', 'Saved', 'SavedArks', 'TheIsland_WP')
    fs.mkdirSync(savedArksDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('zips SavedArks but leaves .arkrbf files out', async () => {
    fs.writeFileSync(path.join(savedArksDir, 'TheIsland.ark'), 'world-save')
    fs.writeFileSync(path.join(savedArksDir, 'TheIsland.ark.arkrbf'), 'rollback-data')

    const profile = makeProfile({ installDir, backupDir })
    const entry = await createBackup(profile)

    const zip = new AdmZip(entry.filePath)
    const names = zip.getEntries().map((e) => e.entryName)
    expect(names).toContain('TheIsland.ark')
    expect(names).not.toContain('TheIsland.ark.arkrbf')
  })
})
