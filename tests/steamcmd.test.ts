import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  buildUpdateArgs,
  describeSteamCmdExitCode,
  getSteamCmdContentLogPath,
  readNewContentLog,
  getAppManifestPath,
  isManifestStuckInErrorState,
  readManifestStateFlags,
  readManifestBuildId,
  getInstalledBuildId,
  isInstallUpToDate,
  updateServer
} from '../src/main/lib/steamcmd'
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

describe('buildUpdateArgs', () => {
  it('targets the ARK:SA dedicated server app id with anonymous login and validation', () => {
    const args = buildUpdateArgs('/servers/my-ark')
    expect(args).toEqual([
      '+force_install_dir',
      '/servers/my-ark',
      '+login',
      'anonymous',
      '+app_update',
      '2430930',
      'validate',
      '+quit'
    ])
  })
})

describe('describeSteamCmdExitCode', () => {
  it('explains exit code 7 as a network/first-run issue', () => {
    expect(describeSteamCmdExitCode(7)).toMatch(/Steam.*online/i)
  })

  it('explains exit code 8 as a disk space issue', () => {
    expect(describeSteamCmdExitCode(8)).toMatch(/disk space/i)
  })

  it('falls back to the raw code for undocumented exit codes', () => {
    expect(describeSteamCmdExitCode(42)).toBe('SteamCMD exited with code 42')
  })
})

describe('getSteamCmdContentLogPath', () => {
  it('points at logs/content_log.txt next to the steamcmd executable', () => {
    expect(getSteamCmdContentLogPath('/managed/steamcmd/steamcmd.exe')).toBe(
      path.join('/managed/steamcmd', 'logs', 'content_log.txt')
    )
  })
})

describe('getAppManifestPath', () => {
  it('points at steamapps/appmanifest_2430930.acf inside the install directory', () => {
    expect(getAppManifestPath('/servers/my-ark')).toBe(
      path.join('/servers/my-ark', 'steamapps', 'appmanifest_2430930.acf')
    )
  })
})

describe('isManifestStuckInErrorState', () => {
  it('detects the documented StateFlags 6 stuck-error state', () => {
    const manifest = '"AppState"\n{\n\t"appid"\t\t"2430930"\n\t"StateFlags"\t\t"6"\n}\n'
    expect(isManifestStuckInErrorState(manifest)).toBe(true)
  })

  it('returns false for a healthy manifest', () => {
    const manifest = '"AppState"\n{\n\t"appid"\t\t"2430930"\n\t"StateFlags"\t\t"4"\n}\n'
    expect(isManifestStuckInErrorState(manifest)).toBe(false)
  })
})

describe('readManifestStateFlags', () => {
  it('parses the StateFlags integer out of the manifest', () => {
    const manifest = '"AppState"\n{\n\t"appid"\t\t"2430930"\n\t"StateFlags"\t\t"4"\n}\n'
    expect(readManifestStateFlags(manifest)).toBe(4)
  })

  it('returns null when there is no StateFlags entry', () => {
    expect(readManifestStateFlags('"AppState"\n{\n\t"appid"\t\t"2430930"\n}\n')).toBeNull()
  })
})

describe('readManifestBuildId', () => {
  it('parses the buildid out of the manifest', () => {
    const manifest = '"AppState"\n{\n\t"appid"\t\t"2430930"\n\t"buildid"\t\t"18742069"\n}\n'
    expect(readManifestBuildId(manifest)).toBe('18742069')
  })

  it('returns null when there is no buildid entry', () => {
    expect(readManifestBuildId('"AppState"\n{\n\t"appid"\t\t"2430930"\n}\n')).toBeNull()
  })
})

describe('getInstalledBuildId', () => {
  it('returns null when the install has no manifest yet', () => {
    const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-buildid-test-'))
    try {
      expect(getInstalledBuildId(installDir)).toBeNull()
    } finally {
      fs.rmSync(installDir, { recursive: true, force: true })
    }
  })

  it('reads the buildid from an existing manifest', () => {
    const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-buildid-test-'))
    try {
      fs.mkdirSync(path.join(installDir, 'steamapps'), { recursive: true })
      fs.writeFileSync(
        getAppManifestPath(installDir),
        '"AppState"\n{\n\t"appid"\t\t"2430930"\n\t"buildid"\t\t"18742069"\n}\n'
      )
      expect(getInstalledBuildId(installDir)).toBe('18742069')
    } finally {
      fs.rmSync(installDir, { recursive: true, force: true })
    }
  })
})

describe('isInstallUpToDate', () => {
  it('is true when the UpdateRequired bit is not set', () => {
    expect(isInstallUpToDate(4)).toBe(true)
  })

  it('is false when the UpdateRequired bit is set (e.g. the stuck 6 state)', () => {
    expect(isInstallUpToDate(6)).toBe(false)
    expect(isInstallUpToDate(2)).toBe(false)
  })

  it('is false when the manifest could not be read at all', () => {
    expect(isInstallUpToDate(null)).toBe(false)
  })
})

describe('readNewContentLog', () => {
  function withTempSteamCmd(run: (steamCmdPath: string, logPath: string) => void): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steamcmd-test-'))
    const logsDir = path.join(dir, 'logs')
    fs.mkdirSync(logsDir)
    const logPath = path.join(logsDir, 'content_log.txt')
    try {
      run(path.join(dir, 'steamcmd.exe'), logPath)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  it('returns only the content written since the given size', () => {
    withTempSteamCmd((steamCmdPath, logPath) => {
      fs.writeFileSync(logPath, 'old line\n')
      const previousSize = fs.statSync(logPath).size
      fs.appendFileSync(logPath, 'ERROR! Disk full.\n')
      expect(readNewContentLog(steamCmdPath, previousSize)).toBe('ERROR! Disk full.\n')
    })
  })

  it('returns an empty string when the log file does not exist', () => {
    withTempSteamCmd((steamCmdPath) => {
      expect(readNewContentLog(steamCmdPath, 0)).toBe('')
    })
  })

  it('returns an empty string when nothing new was written', () => {
    withTempSteamCmd((steamCmdPath, logPath) => {
      fs.writeFileSync(logPath, 'unchanged\n')
      const size = fs.statSync(logPath).size
      expect(readNewContentLog(steamCmdPath, size)).toBe('')
    })
  })
})

describe('updateServer', () => {
  it('rejects with a clear message when the steamCmdPath is set but no longer exists on disk', async () => {
    const missingPath = path.join(os.tmpdir(), 'definitely-does-not-exist', 'steamcmd.exe')
    await expect(updateServer(makeProfile(), missingPath)).rejects.toThrow(/SteamCMD not found at/)
  })

  it('rejects when no steamCmdPath is configured at all', async () => {
    await expect(updateServer(makeProfile(), '')).rejects.toThrow(/Set the SteamCMD path/)
  })
})
