import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  parseArkVersionFromLog,
  getGameVersion,
  getCachedGameVersion,
  setCachedGameVersion
} from '../src/main/lib/serverVersion'

describe('parseArkVersionFromLog', () => {
  it('extracts the version from a real "ARK Version:" log line', () => {
    const content = 'Some earlier line\nARK Version: 92.28\nSome later line\n'
    expect(parseArkVersionFromLog(content)).toBe('92.28')
  })

  it('handles a version with more than two segments', () => {
    expect(parseArkVersionFromLog('ARK Version: 1.2.3')).toBe('1.2.3')
  })

  it('tolerates extra whitespace around the colon', () => {
    expect(parseArkVersionFromLog('ARK Version:    92.28')).toBe('92.28')
  })

  it('returns null when the log has no such line', () => {
    expect(parseArkVersionFromLog('nothing relevant here')).toBeNull()
    expect(parseArkVersionFromLog('')).toBeNull()
  })
})

describe('getGameVersion', () => {
  let tmpDir: string
  let installDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-version-test-'))
    installDir = path.join(tmpDir, 'install')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeLog(content: string): void {
    const logDir = path.join(installDir, 'ShooterGame', 'Saved', 'Logs')
    fs.mkdirSync(logDir, { recursive: true })
    fs.writeFileSync(path.join(logDir, 'ShooterGame.log'), content, 'utf-8')
  }

  it('reads the version straight out of ShooterGame.log', async () => {
    writeLog('Initialize Primal Game Data.\nARK Version: 92.28\nServer has started.\n')
    expect(await getGameVersion(installDir)).toBe('92.28')
  })

  it('resolves to null when the log file does not exist yet', async () => {
    expect(await getGameVersion(installDir)).toBeNull()
  })

  it('resolves to null when the log exists but has no version line yet', async () => {
    writeLog('Server is still booting...\n')
    expect(await getGameVersion(installDir)).toBeNull()
  })

  it('works for a log file that has been sitting there since a previous Manager session', async () => {
    // Same code path as an adopted server - nothing session-specific about reading a file.
    writeLog('ARK Version: 92.28\n' + 'JOIN: SomePlayer\n'.repeat(200))
    expect(await getGameVersion(installDir)).toBe('92.28')
  })
})

describe('game version cache', () => {
  it('returns null for a profile that has never been cached', () => {
    expect(getCachedGameVersion('never-cached-profile')).toBeNull()
  })

  it('returns whatever was stored for that profile', () => {
    setCachedGameVersion('profile-a', '92.28')
    expect(getCachedGameVersion('profile-a')).toBe('92.28')
  })

  it('keeps separate profiles independent', () => {
    setCachedGameVersion('profile-b', '92.28')
    setCachedGameVersion('profile-c', '93.0')
    expect(getCachedGameVersion('profile-b')).toBe('92.28')
    expect(getCachedGameVersion('profile-c')).toBe('93.0')
  })

})
