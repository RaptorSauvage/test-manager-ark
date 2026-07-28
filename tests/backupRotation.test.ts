import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'

vi.mock('../src/main/lib/serverProcess', () => ({ isRunning: vi.fn(() => false) }))
vi.mock('../src/main/lib/rcon', () => ({ sendRconCommand: vi.fn(async () => ({ ok: true, response: 'World Saved' })) }))

import {
  createBackup,
  isIgnoredBackupFile,
  isLegacyBackupFileName,
  listBackups,
  pruneOldBackups,
  selectBackupsToPrune
} from '../src/main/lib/backup'
import { isRunning as mockIsRunning } from '../src/main/lib/serverProcess'
import { sendRconCommand as mockSendRconCommand } from '../src/main/lib/rcon'
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
    group: '',
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

describe('isLegacyBackupFileName', () => {
  it('recognizes a previous manager tool\'s <Map>_<YYYYMMDDHHMMSS>.zip naming', () => {
    expect(isLegacyBackupFileName('Genesis_WP_20260720103215.zip', 'Genesis_WP')).toBe(true)
  })

  it('rejects a file for a different map', () => {
    expect(isLegacyBackupFileName('TheIsland_WP_20260720103215.zip', 'Genesis_WP')).toBe(false)
  })

  it('rejects this app\'s own naming convention', () => {
    expect(isLegacyBackupFileName('My_Server-2026-07-20T10-32-15-123Z.zip', 'Genesis_WP')).toBe(false)
  })

  it('rejects a timestamp of the wrong length', () => {
    expect(isLegacyBackupFileName('Genesis_WP_202607201032.zip', 'Genesis_WP')).toBe(false)
  })

  it('returns false when the profile has no map set', () => {
    expect(isLegacyBackupFileName('Genesis_WP_20260720103215.zip', '')).toBe(false)
  })
})

describe('listBackups', () => {
  let tmpDir: string
  let backupDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-backup-list-test-'))
    backupDir = path.join(tmpDir, 'backups')
    fs.mkdirSync(backupDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('lists both this app\'s own backups and recognized legacy ones', () => {
    fs.writeFileSync(path.join(backupDir, 'Test-2026-07-20T10-00-00-000Z.zip'), 'x')
    fs.writeFileSync(path.join(backupDir, 'Genesis_WP_20260720103215.zip'), 'x')
    fs.writeFileSync(path.join(backupDir, 'unrelated.zip'), 'x')

    const profile = makeProfile({ backupDir, name: 'Test', map: 'Genesis_WP' })
    const backups = listBackups(profile)

    const names = backups.map((b) => b.fileName).sort()
    expect(names).toEqual(['Genesis_WP_20260720103215.zip', 'Test-2026-07-20T10-00-00-000Z.zip'])
    expect(backups.find((b) => b.fileName === 'Genesis_WP_20260720103215.zip')?.legacy).toBe(true)
    expect(backups.find((b) => b.fileName.startsWith('Test-'))?.legacy).toBeUndefined()
  })

  it('never prunes a legacy backup, even well past maxBackups', () => {
    fs.writeFileSync(path.join(backupDir, 'Genesis_WP_20260720103215.zip'), 'x')
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(backupDir, `Test-2026-07-2${i}T10-00-00-000Z.zip`), 'x')
    }

    const profile = makeProfile({ backupDir, name: 'Test', map: 'Genesis_WP', maxBackups: 2 })
    pruneOldBackups(profile)

    const remaining = fs.readdirSync(backupDir)
    expect(remaining).toContain('Genesis_WP_20260720103215.zip')
    expect(remaining.filter((f) => f.startsWith('Test-'))).toHaveLength(2)
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
    fs.writeFileSync(path.join(savedArksDir, 'TheIsland.ark'), 'world-save')
    vi.mocked(mockIsRunning).mockReset().mockReturnValue(false)
    vi.mocked(mockSendRconCommand).mockReset().mockResolvedValue({ ok: true, response: 'World Saved' })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('zips SavedArks but leaves .arkrbf files out', async () => {
    fs.writeFileSync(path.join(savedArksDir, 'TheIsland.ark.arkrbf'), 'rollback-data')

    const profile = makeProfile({ installDir, backupDir })
    const entry = await createBackup(profile)

    const zip = new AdmZip(entry.filePath)
    const names = zip.getEntries().map((e) => e.entryName)
    expect(names).toContain('TheIsland.ark')
    expect(names).not.toContain('TheIsland.ark.arkrbf')
  })

  it('sends SaveWorld over RCON first when the server is currently running', async () => {
    vi.mocked(mockIsRunning).mockReturnValue(true)
    const profile = makeProfile({ installDir, backupDir })

    await createBackup(profile)

    expect(mockSendRconCommand).toHaveBeenCalledWith(profile, 'SaveWorld')
  })

  it('does not attempt a SaveWorld when the server is not running', async () => {
    const profile = makeProfile({ installDir, backupDir })

    await createBackup(profile)

    expect(mockSendRconCommand).not.toHaveBeenCalled()
  })

  it('still backs up whatever is on disk even if the SaveWorld RCON call fails', async () => {
    vi.mocked(mockIsRunning).mockReturnValue(true)
    vi.mocked(mockSendRconCommand).mockResolvedValue({ ok: false, error: 'RCON unreachable' })
    const profile = makeProfile({ installDir, backupDir })

    const entry = await createBackup(profile)

    expect(fs.existsSync(entry.filePath)).toBe(true)
  })
})
