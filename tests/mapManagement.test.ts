import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({ shell: { openPath: vi.fn(async () => '') } }))

import {
  sanitizeMapFolderName,
  listMapFolders,
  createMapFolder,
  deleteMapFolder,
  openMapFolder
} from '../src/main/lib/mapManagement'
import { shell } from 'electron'
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

describe('sanitizeMapFolderName', () => {
  it('accepts a plain name', () => {
    expect(sanitizeMapFolderName('Svartalfheim_WP')).toBe('Svartalfheim_WP')
  })

  it('trims surrounding whitespace', () => {
    expect(sanitizeMapFolderName('  Svartalfheim_WP  ')).toBe('Svartalfheim_WP')
  })

  it('rejects a name containing a path separator', () => {
    expect(() => sanitizeMapFolderName('../evil')).toThrow(/valid folder\/file name/)
    expect(() => sanitizeMapFolderName('foo/bar')).toThrow(/valid folder\/file name/)
    expect(() => sanitizeMapFolderName('foo\\bar')).toThrow(/valid folder\/file name/)
  })

  it('rejects an empty or "." / ".." name', () => {
    expect(() => sanitizeMapFolderName('')).toThrow()
    expect(() => sanitizeMapFolderName('   ')).toThrow()
    expect(() => sanitizeMapFolderName('.')).toThrow()
    expect(() => sanitizeMapFolderName('..')).toThrow()
  })
})

describe('map folder operations', () => {
  let tmpDir: string
  let installDir: string
  let savedArksRoot: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-map-management-test-'))
    installDir = path.join(tmpDir, 'install')
    savedArksRoot = path.join(installDir, 'ShooterGame', 'Saved', 'SavedArks')
    vi.mocked(shell.openPath).mockReset().mockResolvedValue('')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('lists nothing when SavedArks does not exist yet', () => {
    const profile = makeProfile({ installDir })
    expect(listMapFolders(profile)).toEqual([])
  })

  it('creates a map folder with an empty placeholder file', () => {
    const profile = makeProfile({ installDir })

    createMapFolder(profile, 'Svartalfheim', 'Svartalfheim_WP.ark')

    const filePath = path.join(savedArksRoot, 'Svartalfheim', 'Svartalfheim_WP.ark')
    expect(fs.existsSync(filePath)).toBe(true)
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('')
  })

  it('does not overwrite an existing file of the same name', () => {
    const profile = makeProfile({ installDir })
    createMapFolder(profile, 'Svartalfheim', 'Svartalfheim_WP.ark')
    const filePath = path.join(savedArksRoot, 'Svartalfheim', 'Svartalfheim_WP.ark')
    fs.writeFileSync(filePath, 'not empty')

    createMapFolder(profile, 'Svartalfheim', 'Svartalfheim_WP.ark')

    expect(fs.readFileSync(filePath, 'utf-8')).toBe('not empty')
  })

  it('lists created folders sorted alphabetically', () => {
    const profile = makeProfile({ installDir })
    createMapFolder(profile, 'Zeta', 'Zeta.ark')
    createMapFolder(profile, 'Alpha', 'Alpha.ark')

    expect(listMapFolders(profile).map((f) => f.name)).toEqual(['Alpha', 'Zeta'])
  })

  it('deletes a map folder and everything in it', () => {
    const profile = makeProfile({ installDir })
    createMapFolder(profile, 'Svartalfheim', 'Svartalfheim_WP.ark')

    deleteMapFolder(profile, 'Svartalfheim')

    expect(fs.existsSync(path.join(savedArksRoot, 'Svartalfheim'))).toBe(false)
  })

  it('rejects a traversal attempt when creating a folder', () => {
    const profile = makeProfile({ installDir })
    expect(() => createMapFolder(profile, '../escape', 'x.ark')).toThrow()
  })

  it('opens the map folder, creating it first if needed', async () => {
    const profile = makeProfile({ installDir })

    await openMapFolder(profile, 'Svartalfheim')

    expect(fs.existsSync(path.join(savedArksRoot, 'Svartalfheim'))).toBe(true)
    expect(shell.openPath).toHaveBeenCalledWith(path.join(savedArksRoot, 'Svartalfheim'))
  })
})
