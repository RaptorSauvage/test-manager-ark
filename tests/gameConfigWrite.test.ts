import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { upsertIniKey, upsertIniRepeatedKey, syncAseModsToIni, reconcileAseModsFromIni } from '../src/main/lib/gameConfigWrite'
import type { ServerProfile } from '../shared/types'

function makeProfile(overrides: Partial<ServerProfile> = {}): ServerProfile {
  return {
    id: 'test',
    name: 'Test',
    game: 'ark-evolved',
    installDir: '/tmp/ark',
    map: 'Gen2',
    moddedMapEnabled: false,
    moddedMapId: '',
    gamePort: 7777,
    rconPort: 27020,
    queryPort: 27015,
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
    ...overrides
  }
}

describe('upsertIniKey', () => {
  let tmpDir: string
  let filePath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ini-write-test-'))
    filePath = path.join(tmpDir, 'GameUserSettings.ini')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates the file and section fresh when the file does not exist yet', () => {
    upsertIniKey(filePath, 'ServerSettings', 'ActiveMods', '111,222')
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('[ServerSettings]\r\nActiveMods=111,222\r\n')
  })

  it('adds the key to an existing section that does not have it yet, without touching other keys', () => {
    fs.writeFileSync(filePath, '[ServerSettings]\nMaxPlayers=70\nServerPassword=hello\n', 'utf-8')
    upsertIniKey(filePath, 'ServerSettings', 'ActiveMods', '111,222')
    const content = fs.readFileSync(filePath, 'utf-8')
    expect(content).toContain('MaxPlayers=70')
    expect(content).toContain('ServerPassword=hello')
    expect(content).toContain('ActiveMods=111,222')
  })

  it("replaces an existing key's value in place, preserving line order and everything else", () => {
    fs.writeFileSync(
      filePath,
      '[ServerSettings]\nMaxPlayers=70\nActiveMods=999\nServerPassword=hello\n',
      'utf-8'
    )
    upsertIniKey(filePath, 'ServerSettings', 'ActiveMods', '111,222')
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(
      '[ServerSettings]\nMaxPlayers=70\nActiveMods=111,222\nServerPassword=hello\n'
    )
  })

  it('appends a new section at the end when the file exists but that section does not', () => {
    fs.writeFileSync(filePath, '[SessionSettings]\nSessionName=My Server\n', 'utf-8')
    upsertIniKey(filePath, 'ServerSettings', 'ActiveMods', '111')
    const content = fs.readFileSync(filePath, 'utf-8')
    expect(content).toContain('[SessionSettings]')
    expect(content).toContain('SessionName=My Server')
    expect(content).toContain('[ServerSettings]')
    expect(content).toContain('ActiveMods=111')
    // The new section comes after the existing one.
    expect(content.indexOf('[ServerSettings]')).toBeGreaterThan(content.indexOf('[SessionSettings]'))
  })

  it('never touches a same-named key that lives in a different section', () => {
    fs.writeFileSync(filePath, '[ServerSettings]\nFoo=1\n[Other]\nActiveMods=should-not-change\n', 'utf-8')
    upsertIniKey(filePath, 'ServerSettings', 'ActiveMods', '111')
    const content = fs.readFileSync(filePath, 'utf-8')
    expect(content).toContain('ActiveMods=should-not-change')
    expect(content).toContain('[ServerSettings]\nActiveMods=111\nFoo=1')
  })

  it('preserves CRLF line endings when the file already uses them', () => {
    fs.writeFileSync(filePath, '[ServerSettings]\r\nMaxPlayers=70\r\n', 'utf-8')
    upsertIniKey(filePath, 'ServerSettings', 'ActiveMods', '111')
    expect(fs.readFileSync(filePath, 'utf-8')).toContain('\r\n')
    expect(fs.readFileSync(filePath, 'utf-8')).not.toMatch(/[^\r]\n/)
  })
})

describe('upsertIniRepeatedKey', () => {
  let tmpDir: string
  let filePath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ini-write-test-'))
    filePath = path.join(tmpDir, 'Game.ini')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates the file, section and every line fresh when the file does not exist yet', () => {
    upsertIniRepeatedKey(filePath, 'ModInstaller', 'ModIDS', ['111', '222', '333'])
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(
      '[ModInstaller]\r\nModIDS=111\r\nModIDS=222\r\nModIDS=333\r\n'
    )
  })

  it('is a no-op when the section does not exist and values is empty', () => {
    fs.writeFileSync(filePath, '[Other]\nFoo=1\n', 'utf-8')
    upsertIniRepeatedKey(filePath, 'ModInstaller', 'ModIDS', [])
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('[Other]\nFoo=1\n')
  })

  it('replaces an existing run of repeated lines with a new, differently-sized set', () => {
    fs.writeFileSync(
      filePath,
      '[ModInstaller]\nModIDS=111\nModIDS=222\n[Other]\nFoo=1\n',
      'utf-8'
    )
    upsertIniRepeatedKey(filePath, 'ModInstaller', 'ModIDS', ['999', '888', '777', '666'])
    const content = fs.readFileSync(filePath, 'utf-8')
    expect(content).toBe('[ModInstaller]\nModIDS=999\nModIDS=888\nModIDS=777\nModIDS=666\n[Other]\nFoo=1\n')
  })

  it('removes every line in the run when values is empty, leaving the section header and other content', () => {
    fs.writeFileSync(
      filePath,
      '[ModInstaller]\nModIDS=111\nModIDS=222\n[Other]\nFoo=1\n',
      'utf-8'
    )
    upsertIniRepeatedKey(filePath, 'ModInstaller', 'ModIDS', [])
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('[ModInstaller]\n[Other]\nFoo=1\n')
  })

  it('inserts a fresh block right after the section header when it has no matching lines yet', () => {
    fs.writeFileSync(filePath, '[ModInstaller]\nSomeOtherKey=1\n', 'utf-8')
    upsertIniRepeatedKey(filePath, 'ModInstaller', 'ModIDS', ['111', '222'])
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(
      '[ModInstaller]\nModIDS=111\nModIDS=222\nSomeOtherKey=1\n'
    )
  })

  it('never touches a same-named repeated key that lives in a different section', () => {
    fs.writeFileSync(filePath, '[ModInstaller]\nModIDS=111\n[Other]\nModIDS=should-not-change\n', 'utf-8')
    upsertIniRepeatedKey(filePath, 'ModInstaller', 'ModIDS', ['999'])
    const content = fs.readFileSync(filePath, 'utf-8')
    expect(content).toContain('ModIDS=should-not-change')
    expect(content).toContain('[ModInstaller]\nModIDS=999\n[Other]')
  })
})

describe('syncAseModsToIni', () => {
  let tmpDir: string
  let installDir: string
  let gusPath: string
  let gameIniPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ase-mods-sync-test-'))
    installDir = path.join(tmpDir, 'install')
    const configDir = path.join(installDir, 'ShooterGame', 'Saved', 'Config', 'WindowsServer')
    fs.mkdirSync(configDir, { recursive: true })
    gusPath = path.join(configDir, 'GameUserSettings.ini')
    gameIniPath = path.join(configDir, 'Game.ini')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates the Config/WindowsServer folder tree when it does not exist yet (a fresh install)', () => {
    // A real failure: a profile whose install has never been started once (so
    // ShooterGame/Saved/Config/WindowsServer doesn't exist at all yet) threw ENOENT on save.
    const freshInstallDir = path.join(tmpDir, 'fresh-install')
    fs.mkdirSync(freshInstallDir, { recursive: true })
    expect(() =>
      syncAseModsToIni(
        makeProfile({ installDir: freshInstallDir, mods: [{ id: '111', enabled: true, passive: false, dev: false }] })
      )
    ).not.toThrow()
    const configDir = path.join(freshInstallDir, 'ShooterGame', 'Saved', 'Config', 'WindowsServer')
    expect(fs.readFileSync(path.join(configDir, 'GameUserSettings.ini'), 'utf-8')).toContain('ActiveMods=111')
    expect(fs.readFileSync(path.join(configDir, 'Game.ini'), 'utf-8')).toContain('ModIDS=111')
  })

  it('writes only enabled mods, in order, to both files', () => {
    syncAseModsToIni(
      makeProfile({
        installDir,
        mods: [
          { id: '111', enabled: true, passive: false, dev: false },
          { id: '222', enabled: false, passive: false, dev: false },
          { id: '333', enabled: true, passive: false, dev: false }
        ]
      })
    )
    expect(fs.readFileSync(gusPath, 'utf-8')).toContain('ActiveMods=111,333')
    const gameIni = fs.readFileSync(gameIniPath, 'utf-8')
    expect(gameIni).toContain('[ModInstaller]')
    expect(gameIni).toContain('ModIDS=111')
    expect(gameIni).toContain('ModIDS=333')
    expect(gameIni).not.toContain('ModIDS=222')
  })

  it('is a no-op for ark-ascended - no command-line mechanism means no ini need for it', () => {
    syncAseModsToIni(
      makeProfile({ game: 'ark-ascended', installDir, mods: [{ id: '111', enabled: true, passive: false, dev: false }] })
    )
    expect(fs.existsSync(gusPath)).toBe(false)
    expect(fs.existsSync(gameIniPath)).toBe(false)
  })

  it('re-syncing with an empty mod list clears both, without deleting unrelated settings', () => {
    fs.writeFileSync(gusPath, '[ServerSettings]\nMaxPlayers=70\nActiveMods=999\n', 'utf-8')
    fs.writeFileSync(gameIniPath, '[ModInstaller]\nModIDS=999\n[Other]\nFoo=1\n', 'utf-8')

    syncAseModsToIni(makeProfile({ installDir, mods: [] }))

    expect(fs.readFileSync(gusPath, 'utf-8')).toContain('MaxPlayers=70\nActiveMods=\n')
    const gameIni = fs.readFileSync(gameIniPath, 'utf-8')
    expect(gameIni).not.toContain('ModIDS=')
    expect(gameIni).toContain('[Other]\nFoo=1')
  })
})

describe('reconcileAseModsFromIni', () => {
  let tmpDir: string
  let installDir: string
  let gusPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ase-mods-reconcile-test-'))
    installDir = path.join(tmpDir, 'install')
    const configDir = path.join(installDir, 'ShooterGame', 'Saved', 'Config', 'WindowsServer')
    fs.mkdirSync(configDir, { recursive: true })
    gusPath = path.join(configDir, 'GameUserSettings.ini')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('adds a mod id found in ActiveMods= that the profile does not have yet, as a new enabled entry', () => {
    fs.writeFileSync(gusPath, '[ServerSettings]\nActiveMods=111,222\n', 'utf-8')
    const profile = makeProfile({ installDir, mods: [{ id: '111', enabled: true, passive: false, dev: false }] })

    const mods = reconcileAseModsFromIni(profile)

    expect(mods).toEqual([
      { id: '111', enabled: true, passive: false, dev: false },
      { id: '222', enabled: true, passive: false, dev: false }
    ])
  })

  it('returns the exact same array reference when nothing new is found (cheap no-op check)', () => {
    fs.writeFileSync(gusPath, '[ServerSettings]\nActiveMods=111\n', 'utf-8')
    const profile = makeProfile({ installDir, mods: [{ id: '111', enabled: true, passive: false, dev: false }] })

    expect(reconcileAseModsFromIni(profile)).toBe(profile.mods)
  })

  it('never touches an existing entry - a disabled mod stays disabled, correctly absent from ActiveMods=', () => {
    fs.writeFileSync(gusPath, '[ServerSettings]\nActiveMods=111\n', 'utf-8')
    const profile = makeProfile({
      installDir,
      mods: [
        { id: '111', enabled: true, passive: false, dev: false },
        { id: '999', enabled: false, passive: false, dev: false, name: 'Kept disabled' }
      ]
    })

    const mods = reconcileAseModsFromIni(profile)

    expect(mods).toBe(profile.mods)
    expect(mods.find((m) => m.id === '999')).toEqual({
      id: '999',
      enabled: false,
      passive: false,
      dev: false,
      name: 'Kept disabled'
    })
  })

  it('is a no-op for ark-ascended', () => {
    fs.writeFileSync(gusPath, '[ServerSettings]\nActiveMods=111\n', 'utf-8')
    const profile = makeProfile({ game: 'ark-ascended', installDir, mods: [] })

    expect(reconcileAseModsFromIni(profile)).toBe(profile.mods)
  })

  it('is a no-op when GameUserSettings.ini does not exist yet', () => {
    const profile = makeProfile({ installDir: path.join(tmpDir, 'never-started'), mods: [] })
    expect(reconcileAseModsFromIni(profile)).toBe(profile.mods)
  })
})
