import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'

vi.mock('../src/main/lib/serverProcess', () => ({ isRunning: vi.fn(() => false) }))
vi.mock('../src/main/lib/rcon', () => ({ sendRconCommand: vi.fn(async () => ({ ok: true, response: 'World Saved' })) }))

import {
  createBackup,
  getBackupLog,
  isIgnoredBackupFile,
  listBackups,
  pruneOldBackups,
  restoreBackup,
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

  it('ignores ARK\'s own native periodic backups', () => {
    expect(isIgnoredBackupFile('Extinction_WP_29.07.2026_20.00.01.ark')).toBe(true)
    expect(isIgnoredBackupFile('TheIsland_15.01.2026_03.30.00.ark')).toBe(true)
  })

  it('keeps the main map save file even when the map name has an underscore', () => {
    expect(isIgnoredBackupFile('Extinction_WP.ark')).toBe(false)
    expect(isIgnoredBackupFile('TheIsland_WP.ark')).toBe(false)
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

  it('lists every .zip in the backup directory, regardless of naming', () => {
    fs.writeFileSync(path.join(backupDir, 'Genesis_WP-2026-07-20T10-00-00-000Z.zip'), 'x')
    fs.writeFileSync(path.join(backupDir, 'Genesis_WP_20260720103215.zip'), 'x')
    fs.writeFileSync(path.join(backupDir, 'unrelated.zip'), 'x')
    fs.writeFileSync(path.join(backupDir, 'not-a-zip.txt'), 'x')

    const profile = makeProfile({ backupDir, name: 'Test', map: 'Genesis_WP' })
    const names = listBackups(profile).map((b) => b.fileName).sort()

    expect(names).toEqual([
      'Genesis_WP-2026-07-20T10-00-00-000Z.zip',
      'Genesis_WP_20260720103215.zip',
      'unrelated.zip'
    ])
  })

  it('prunes down to maxBackups across every zip in the folder, regardless of naming', () => {
    const fileNames = ['Genesis_WP_20260720103215.zip', 'a.zip', 'b.zip', 'c.zip', 'd.zip']
    fileNames.forEach((fileName, i) => {
      const filePath = path.join(backupDir, fileName)
      fs.writeFileSync(filePath, 'x')
      const time = new Date(2026, 0, i + 1)
      fs.utimesSync(filePath, time, time)
    })

    const profile = makeProfile({ backupDir, name: 'Test', map: 'Genesis_WP', maxBackups: 2 })
    pruneOldBackups(profile)

    const remaining = fs.readdirSync(backupDir).sort()
    expect(remaining).toEqual(['c.zip', 'd.zip'])
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
    vi.mocked(mockIsRunning).mockReset().mockReturnValue(true)
    vi.mocked(mockSendRconCommand).mockReset().mockResolvedValue({ ok: true, response: 'World Saved' })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('zips SavedArks (adding files one by one) but leaves .arkrbf files out', async () => {
    fs.writeFileSync(path.join(savedArksDir, 'TheIsland.ark.arkrbf'), 'rollback-data')

    const profile = makeProfile({ installDir, backupDir })
    const entry = await createBackup(profile, 0)

    const zip = new AdmZip(entry.filePath)
    const names = zip.getEntries().map((e) => e.entryName)
    expect(names).toContain('TheIsland.ark')
    expect(names).not.toContain('TheIsland.ark.arkrbf')
  })

  it('names the zip after the map, not the profile name', async () => {
    const profile = makeProfile({ installDir, backupDir, name: 'My Cluster Server', map: 'TheIsland_WP' })

    const entry = await createBackup(profile, 0)

    expect(entry.fileName.startsWith('TheIsland_WP-')).toBe(true)
    expect(entry.fileName).not.toContain('My_Cluster_Server')
  })

  it('sends SaveGame over RCON before zipping', async () => {
    const profile = makeProfile({ installDir, backupDir })

    await createBackup(profile, 0)

    expect(mockSendRconCommand).toHaveBeenCalledWith(profile, 'SaveWorld')
  })

  it('backs up without SaveGame when the server is not running - the files are already static', async () => {
    vi.mocked(mockIsRunning).mockReturnValue(false)
    const profile = makeProfile({ installDir, backupDir })

    const entry = await createBackup(profile, 0)

    expect(mockSendRconCommand).not.toHaveBeenCalled()
    expect(fs.existsSync(entry.filePath)).toBe(true)
  })

  it('cancels the backup when SaveGame does not confirm', async () => {
    vi.mocked(mockSendRconCommand).mockResolvedValue({ ok: false, error: 'RCON unreachable' })
    const profile = makeProfile({ installDir, backupDir })

    await expect(createBackup(profile, 0)).rejects.toThrow('SaveGame did not confirm')
    expect(fs.existsSync(backupDir)).toBe(false)
  })

  it('waits saveSettleMs after a confirmed SaveGame before zipping, to let the save settle', async () => {
    const profile = makeProfile({ installDir, backupDir })

    const start = Date.now()
    await createBackup(profile, 50)

    expect(Date.now() - start).toBeGreaterThanOrEqual(45)
  })

  it('logs each step of a successful backup', async () => {
    const profile = makeProfile({ id: 'log-success', installDir, backupDir })

    await createBackup(profile, 0)

    const messages = getBackupLog(profile.id).map((entry) => entry.message)
    expect(messages.some((m) => m.includes('Sending SaveGame'))).toBe(true)
    expect(messages.some((m) => m.includes('SaveGame confirmed'))).toBe(true)
    expect(messages.some((m) => m.includes('Zipping'))).toBe(true)
    expect(messages.some((m) => m.includes('Backup created'))).toBe(true)
    expect(getBackupLog(profile.id).every((entry) => entry.level === 'info')).toBe(true)
  })

  it('logs an error entry when the backup is cancelled', async () => {
    vi.mocked(mockSendRconCommand).mockResolvedValue({ ok: false, error: 'RCON unreachable' })
    const profile = makeProfile({ id: 'log-cancelled', installDir, backupDir })

    await expect(createBackup(profile, 0)).rejects.toThrow()

    const log = getBackupLog(profile.id)
    expect(log.some((entry) => entry.level === 'error')).toBe(true)
    expect(log.some((entry) => entry.message.includes('SaveGame did not confirm'))).toBe(true)
  })

  it('logs a note instead of SaveGame when the server is not running', async () => {
    vi.mocked(mockIsRunning).mockReturnValue(false)
    const profile = makeProfile({ id: 'log-not-running', installDir, backupDir })

    await createBackup(profile, 0)

    const messages = getBackupLog(profile.id).map((entry) => entry.message)
    expect(messages.some((m) => m.includes('not running'))).toBe(true)
    expect(messages.some((m) => m.includes('Sending SaveGame'))).toBe(false)
  })
})

describe('restoreBackup', () => {
  let tmpDir: string
  let installDir: string
  let backupDir: string
  let savedArksDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-restore-test-'))
    installDir = path.join(tmpDir, 'install')
    backupDir = path.join(tmpDir, 'backups')
    savedArksDir = path.join(installDir, 'ShooterGame', 'Saved', 'SavedArks', 'TheIsland_WP')
    fs.mkdirSync(savedArksDir, { recursive: true })
    fs.mkdirSync(backupDir, { recursive: true })
    fs.writeFileSync(path.join(savedArksDir, 'TheIsland.ark'), 'world-save')
    vi.mocked(mockIsRunning).mockReset().mockReturnValue(false)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('refuses to restore while the server is running', () => {
    vi.mocked(mockIsRunning).mockReturnValue(true)
    const backupZip = path.join(backupDir, 'fixture.zip')
    new AdmZip().writeZip(backupZip)
    const profile = makeProfile({ installDir, backupDir })

    expect(() => restoreBackup(profile, backupZip)).toThrow('Stop the server')
    expect(fs.existsSync(path.join(savedArksDir, 'TheIsland.ark'))).toBe(true)
  })

  it('restores into SavedArks when the server is stopped', () => {
    const backupZip = path.join(backupDir, 'fixture.zip')
    const zip = new AdmZip()
    zip.addFile('Restored.ark', Buffer.from('restored-save'))
    zip.writeZip(backupZip)
    const profile = makeProfile({ installDir, backupDir })

    restoreBackup(profile, backupZip)

    expect(fs.readFileSync(path.join(savedArksDir, 'Restored.ark'), 'utf-8')).toBe('restored-save')
  })
})
