import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  buildUpdateArgs,
  describeSteamCmdExitCode,
  getSteamCmdContentLogPath,
  readNewContentLog
} from '../src/main/lib/steamcmd'

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
