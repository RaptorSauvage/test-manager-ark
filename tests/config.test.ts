import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readIniFile, readAdminPassword } from '../src/main/lib/config'

describe('readIniFile', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-config-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('parses a normal ini file', () => {
    const filePath = path.join(tmpDir, 'GameUserSettings.ini')
    fs.writeFileSync(filePath, '[ServerSettings]\r\nServerAdminPassword=hunter2\r\n')

    expect(readIniFile(filePath).ServerSettings.ServerAdminPassword).toBe('hunter2')
  })

  it('parses an ini file saved with a leading UTF-8 BOM', () => {
    const filePath = path.join(tmpDir, 'GameUserSettings.ini')
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    fs.writeFileSync(filePath, Buffer.concat([bom, Buffer.from('[ServerSettings]\r\nServerAdminPassword=hunter2\r\n')]))

    expect(readIniFile(filePath).ServerSettings.ServerAdminPassword).toBe('hunter2')
  })

  it('returns an empty object when the file does not exist', () => {
    expect(readIniFile(path.join(tmpDir, 'missing.ini'))).toEqual({})
  })

  it('returns an empty object instead of throwing when the disk read itself fails', () => {
    // readAdminPassword is called from buildLaunchArgs on every single server start - a real
    // report on Windows showed a disk-level read failure here crashing the 'server:start'
    // IPC handler outright, meaning a server couldn't even be started.
    const filePath = path.join(tmpDir, 'GameUserSettings.ini')
    fs.writeFileSync(filePath, '[ServerSettings]\r\nServerAdminPassword=hunter2\r\n')
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw Object.assign(new Error('unknown error, read'), { code: 'UNKNOWN', errno: -4094 })
    })
    try {
      expect(readIniFile(filePath)).toEqual({})
    } finally {
      spy.mockRestore()
    }
  })
})

describe('readAdminPassword', () => {
  let tmpDir: string
  let installDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-config-test-'))
    installDir = path.join(tmpDir, 'install')
    fs.mkdirSync(path.join(installDir, 'ShooterGame', 'Saved', 'Config', 'WindowsServer'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('reads the password from a BOM-prefixed GameUserSettings.ini', () => {
    const filePath = path.join(installDir, 'ShooterGame', 'Saved', 'Config', 'WindowsServer', 'GameUserSettings.ini')
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    fs.writeFileSync(filePath, Buffer.concat([bom, Buffer.from('[ServerSettings]\r\nServerAdminPassword=hunter2\r\n')]))

    expect(readAdminPassword(installDir)).toBe('hunter2')
  })

  it('returns an empty string when there is no GameUserSettings.ini yet', () => {
    expect(readAdminPassword(installDir)).toBe('')
  })
})
