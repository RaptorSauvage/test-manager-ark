import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import type { ServerProfile, IniTemplateContent, IniTemplateProfileOverride, ModEventHistoryEntry } from '../shared/types'

function makeProfile(overrides: Partial<ServerProfile> = {}): ServerProfile {
  return {
    id: 'p1',
    name: 'Island Server',
    game: 'ark-ascended',
    installDir: '/tmp/ark',
    map: 'TheIsland_WP',
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

const { mockGeneric, mockOverrides, mockHistory, mockProfiles } = vi.hoisted(() => ({
  mockGeneric: { value: { gameUserSettingsIni: '', gameIni: '' } as IniTemplateContent },
  mockOverrides: { value: new Map<string, IniTemplateProfileOverride>() },
  mockHistory: { value: [] as ModEventHistoryEntry[] },
  mockProfiles: { value: [] as ServerProfile[] }
}))

vi.mock('../src/main/store', () => ({
  listProfiles: () => mockProfiles.value,
  getIniTemplateGeneric: () => mockGeneric.value,
  getIniTemplateOverride: (profileId: string) => mockOverrides.value.get(profileId),
  recordConfigFileHistory: (profileId: string, relPath: string, content: string) => {
    mockHistory.value.push({
      id: `h-${mockHistory.value.length}`,
      eventId: profileId,
      eventName: relPath,
      action: 'activated',
      timestamp: Date.now(),
      profileIds: [profileId]
    } as unknown as ModEventHistoryEntry)
    void content
  }
}))

describe('applyIniTemplate/applyIniTemplateToAll', () => {
  let tmpDir: string
  let installDir: string
  let configDir: string
  let gusPath: string
  let gamePath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ini-templates-test-'))
    installDir = path.join(tmpDir, 'install')
    configDir = path.join(installDir, 'ShooterGame', 'Saved', 'Config', 'WindowsServer')
    fs.mkdirSync(configDir, { recursive: true })
    gusPath = path.join(configDir, 'GameUserSettings.ini')
    gamePath = path.join(configDir, 'Game.ini')
    mockGeneric.value = { gameUserSettingsIni: '', gameIni: '' }
    mockOverrides.value = new Map()
    mockHistory.value = []
    mockProfiles.value = []
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('applies the generic template and force-sets SessionName to the profile name', async () => {
    const { applyIniTemplate } = await import('../src/main/lib/iniTemplates')
    mockGeneric.value = { gameUserSettingsIni: '[ServerSettings]\nServerPVE=False\nMaxPlayers=70', gameIni: '' }
    applyIniTemplate(makeProfile({ installDir, name: 'My Cool Server' }))

    const content = fs.readFileSync(gusPath, 'utf-8')
    expect(content).toContain('ServerPVE=False')
    expect(content).toContain('MaxPlayers=70')
    expect(content).toContain('[SessionSettings]')
    expect(content).toContain('SessionName=My Cool Server')
  })

  it("the profile's own override is appended behind a ';Server Specific INI' marker, after the generic template", async () => {
    const { applyIniTemplate } = await import('../src/main/lib/iniTemplates')
    mockGeneric.value = { gameUserSettingsIni: '[ServerSettings]\nMaxPlayers=70', gameIni: '' }
    mockOverrides.value.set('p1', { profileId: 'p1', gameUserSettingsIni: '[ServerSettings]\nMaxPlayers=10', gameIni: '' })
    applyIniTemplate(makeProfile({ installDir }))

    const content = fs.readFileSync(gusPath, 'utf-8')
    const markerIndex = content.indexOf(';Server Specific INI')
    expect(markerIndex).toBeGreaterThan(-1)
    // The generic value is left exactly where it was written; the override is appended after
    // the marker, so a game reading the file top-to-bottom sees the override's value last.
    expect(content.indexOf('MaxPlayers=70')).toBeLessThan(markerIndex)
    expect(content.indexOf('MaxPlayers=10')).toBeGreaterThan(markerIndex)
  })

  it("the forced SessionName always wins, even if the server's own override tries to set its own", async () => {
    // A real imported override file (see the "existing INI files" use case) very plausibly
    // carries its own SessionName line - without stripping it, that line would be the file's
    // last occurrence of the key and win under ARK's own last-value-wins ini parsing.
    const { applyIniTemplate } = await import('../src/main/lib/iniTemplates')
    mockGeneric.value = { gameUserSettingsIni: '', gameIni: '' }
    mockOverrides.value.set('p1', {
      profileId: 'p1',
      gameUserSettingsIni: '[SessionSettings]\nSessionName=Some Other Name\n[ServerSettings]\nMaxPlayers=10',
      gameIni: ''
    })
    applyIniTemplate(makeProfile({ installDir, name: 'My Cool Server' }))

    const content = fs.readFileSync(gusPath, 'utf-8')
    expect(content).toContain('SessionName=My Cool Server')
    expect(content).not.toContain('Some Other Name')
    expect(content).toContain('MaxPlayers=10')
  })

  it('re-applying replaces the previous server-specific block instead of appending a second one', async () => {
    const { applyIniTemplate } = await import('../src/main/lib/iniTemplates')
    mockGeneric.value = { gameUserSettingsIni: '[ServerSettings]\nMaxPlayers=70', gameIni: '' }
    mockOverrides.value.set('p1', { profileId: 'p1', gameUserSettingsIni: '[ServerSettings]\nMaxPlayers=10', gameIni: '' })
    applyIniTemplate(makeProfile({ installDir }))
    mockOverrides.value.set('p1', { profileId: 'p1', gameUserSettingsIni: '[ServerSettings]\nMaxPlayers=20', gameIni: '' })
    applyIniTemplate(makeProfile({ installDir }))

    const content = fs.readFileSync(gusPath, 'utf-8')
    expect(content.match(/;Server Specific INI/g)).toHaveLength(1)
    expect(content).toContain('MaxPlayers=20')
    expect(content).not.toContain('MaxPlayers=10')
  })

  it('removes the server-specific marker and block entirely once the override is cleared', async () => {
    const { applyIniTemplate } = await import('../src/main/lib/iniTemplates')
    mockGeneric.value = { gameUserSettingsIni: '[ServerSettings]\nMaxPlayers=70', gameIni: '' }
    mockOverrides.value.set('p1', { profileId: 'p1', gameUserSettingsIni: '[ServerSettings]\nMaxPlayers=10', gameIni: '' })
    applyIniTemplate(makeProfile({ installDir }))
    mockOverrides.value.delete('p1')
    applyIniTemplate(makeProfile({ installDir }))

    const content = fs.readFileSync(gusPath, 'utf-8')
    expect(content).not.toContain(';Server Specific INI')
    expect(content).not.toContain('MaxPlayers=10')
    expect(content).toContain('MaxPlayers=70')
  })

  it('writes to Game.ini too, independently of GameUserSettings.ini', async () => {
    const { applyIniTemplate } = await import('../src/main/lib/iniTemplates')
    mockGeneric.value = {
      gameUserSettingsIni: '',
      gameIni: '[/script/shootergame.shootergamemode]\nXPMultiplier=2.0'
    }
    applyIniTemplate(makeProfile({ installDir }))

    expect(fs.readFileSync(gamePath, 'utf-8')).toContain('XPMultiplier=2.0')
  })

  it('leaves Game.ini untouched entirely when neither template has anything for it', async () => {
    const { applyIniTemplate } = await import('../src/main/lib/iniTemplates')
    mockGeneric.value = { gameUserSettingsIni: '[ServerSettings]\nMaxPlayers=70', gameIni: '' }
    applyIniTemplate(makeProfile({ installDir }))

    expect(fs.existsSync(gamePath)).toBe(false)
  })

  it('never touches a manually-added line the templates never mention', async () => {
    const { applyIniTemplate } = await import('../src/main/lib/iniTemplates')
    fs.writeFileSync(gusPath, '[ServerSettings]\nServerAdminPassword=secret\n', 'utf-8')
    mockGeneric.value = { gameUserSettingsIni: '[ServerSettings]\nMaxPlayers=70', gameIni: '' }
    applyIniTemplate(makeProfile({ installDir }))

    expect(fs.readFileSync(gusPath, 'utf-8')).toContain('ServerAdminPassword=secret')
  })

  it('treats a dotted section name (ARK\'s own /script/shootergame.shootergamemode) as one flat literal, not a nested path', async () => {
    // The `ini` package expands a dotted key/section into nested objects by default - without
    // escapeSectionDots, this would either crash flattening a nested object or silently drop
    // the setting, for what's actually the single most common section in a real Game.ini.
    const { applyIniTemplate } = await import('../src/main/lib/iniTemplates')
    mockGeneric.value = {
      gameUserSettingsIni: '',
      gameIni: '[/script/shootergame.shootergamemode]\nXPMultiplier=2.0\nTamingSpeedMultiplier=3.0'
    }
    applyIniTemplate(makeProfile({ installDir }))

    const content = fs.readFileSync(gamePath, 'utf-8')
    expect(content).toContain('[/script/shootergame.shootergamemode]')
    expect(content).toContain('XPMultiplier=2.0')
    expect(content).toContain('TamingSpeedMultiplier=3.0')
  })

  it('silently ignores a sectionless/malformed line instead of erroring - ini.parse itself never throws on one', async () => {
    const { applyIniTemplate } = await import('../src/main/lib/iniTemplates')
    mockGeneric.value = { gameUserSettingsIni: 'NotAValidLineWithoutASection', gameIni: '' }
    expect(() => applyIniTemplate(makeProfile({ installDir }))).not.toThrow()
    expect(fs.readFileSync(gusPath, 'utf-8')).not.toContain('NotAValidLineWithoutASection')
  })

  it("applyIniTemplateToAll reports each profile's own outcome without one failure blocking the rest", async () => {
    const { applyIniTemplateToAll } = await import('../src/main/lib/iniTemplates')
    const goodInstallDir = path.join(tmpDir, 'install-good')
    const badInstallDir = path.join(tmpDir, 'install-bad')
    fs.mkdirSync(path.join(goodInstallDir, 'ShooterGame', 'Saved', 'Config', 'WindowsServer'), { recursive: true })
    fs.mkdirSync(path.join(badInstallDir, 'ShooterGame', 'Saved', 'Config', 'WindowsServer'), { recursive: true })

    mockGeneric.value = { gameUserSettingsIni: '[ServerSettings]\nMaxPlayers=70', gameIni: '' }
    mockProfiles.value = [
      makeProfile({ id: 'good', name: 'Good Server', installDir: goodInstallDir }),
      makeProfile({ id: 'bad', name: 'Bad Server', installDir: badInstallDir })
    ]

    // A real disk/permission failure (e.g. the config dir locked read-only while the server
    // is running) rather than relying on ini.parse to throw, which it never actually does -
    // same reasoning as upsertIniKey's own disk-failure test in gameConfigWrite.test.ts.
    const realWriteFileSync = fs.writeFileSync
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation((filePath, ...rest: unknown[]) => {
      if (String(filePath).includes('install-bad')) throw new Error('simulated disk failure')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (realWriteFileSync as any)(filePath, ...rest)
    })
    try {
      const results = await applyIniTemplateToAll()
      expect(results).toEqual([
        { profileId: 'good', profileName: 'Good Server', ok: true },
        { profileId: 'bad', profileName: 'Bad Server', ok: false, error: expect.stringContaining('simulated disk failure') }
      ])
    } finally {
      spy.mockRestore()
    }
  })
})
