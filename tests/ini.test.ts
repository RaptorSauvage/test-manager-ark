import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readConfigSummary, writeConfigSummary } from '../src/main/lib/config'
import type { ServerProfile } from '../shared/types'

function makeProfile(installDir: string): ServerProfile {
  return {
    id: 'test',
    name: 'Test Server',
    installDir,
    map: 'TheIsland_WP',
    gamePort: 7777,
    queryPort: 27015,
    rconPort: 27020,
    rconPassword: 'secret',
    savedArksSubPath: 'ShooterGame/Saved/SavedArks',
    backupDir: path.join(installDir, 'backups'),
    maxBackups: 10,
    mods: [],
    extraArgs: ''
  }
}

describe('config ini read/write round-trip', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-config-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns sensible defaults when no ini file exists yet', () => {
    const profile = makeProfile(tmpDir)
    const summary = readConfigSummary(profile)
    expect(summary.maxPlayers).toBe(70)
    expect(summary.pve).toBe(false)
  })

  it('writes and re-reads a config summary', () => {
    const profile = makeProfile(tmpDir)
    writeConfigSummary(profile, {
      sessionName: 'My Ark Server',
      serverPassword: 'join-me',
      serverAdminPassword: 'admin-secret',
      maxPlayers: 20,
      difficultyOffset: 1,
      xpMultiplier: 2.5,
      tamingSpeedMultiplier: 3,
      harvestAmountMultiplier: 2,
      pve: true
    })

    const summary = readConfigSummary(profile)
    expect(summary.sessionName).toBe('My Ark Server')
    expect(summary.maxPlayers).toBe(20)
    expect(summary.xpMultiplier).toBe(2.5)
    expect(summary.pve).toBe(true)
  })

  it('turns a locked/read-only file EPERM into an actionable error instead of a raw stack trace', () => {
    const profile = makeProfile(tmpDir)
    const eperm = Object.assign(new Error('EPERM: operation not permitted, open'), { code: 'EPERM' })
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw eperm
    })

    try {
      expect(() =>
        writeConfigSummary(profile, {
          sessionName: 'x',
          serverPassword: '',
          serverAdminPassword: '',
          maxPlayers: 10,
          difficultyOffset: 1,
          xpMultiplier: 1,
          tamingSpeedMultiplier: 1,
          harvestAmountMultiplier: 1,
          pve: false
        })
      ).toThrow(/open in another program/)
    } finally {
      spy.mockRestore()
    }
  })
})
