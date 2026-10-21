import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  listFileBrowserEntries,
  resolveFileBrowserPath,
  deleteFileBrowserFile,
  readIniFile,
  writeIniFile,
  listIniHistory,
  diffIniHistoryEntry,
  restoreIniHistoryEntry,
  isIniPath,
  isJsonPath,
  isLogPath,
  isEditableTextPath,
  isOpenableTextPath
} from '../src/main/lib/fileBrowser'

describe('isIniPath / isJsonPath / isLogPath', () => {
  it('matches their own extension case-insensitively', () => {
    expect(isIniPath('GameUserSettings.ini')).toBe(true)
    expect(isIniPath('game.INI')).toBe(true)
    expect(isIniPath('ShooterGame.log')).toBe(false)
    expect(isJsonPath('curseforge_config.json')).toBe(true)
    expect(isJsonPath('config.JSON')).toBe(true)
    expect(isJsonPath('GameUserSettings.ini')).toBe(false)
    expect(isLogPath('ShooterGame.log')).toBe(true)
    expect(isLogPath('ShooterGame.LOG')).toBe(true)
    expect(isLogPath('GameUserSettings.ini')).toBe(false)
  })
})

describe('isEditableTextPath / isOpenableTextPath', () => {
  it('editable covers .ini and .json only', () => {
    expect(isEditableTextPath('Game.ini')).toBe(true)
    expect(isEditableTextPath('config.json')).toBe(true)
    expect(isEditableTextPath('ShooterGame.log')).toBe(false)
    expect(isEditableTextPath('root-file.txt')).toBe(false)
  })

  it('openable additionally covers .log (read-only)', () => {
    expect(isOpenableTextPath('Game.ini')).toBe(true)
    expect(isOpenableTextPath('config.json')).toBe(true)
    expect(isOpenableTextPath('ShooterGame.log')).toBe(true)
    expect(isOpenableTextPath('root-file.txt')).toBe(false)
  })
})

describe('fileBrowser - list/resolve/delete', () => {
  let installDir: string

  beforeEach(() => {
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-browser-test-'))
    fs.mkdirSync(path.join(installDir, 'ShooterGame', 'Saved', 'Config'), { recursive: true })
    fs.writeFileSync(path.join(installDir, 'ShooterGame', 'Saved', 'Config', 'Test.ini'), '[Test]\nFoo=Bar\n')
    fs.writeFileSync(path.join(installDir, 'root-file.txt'), 'hello')
  })

  afterEach(() => {
    fs.rmSync(installDir, { recursive: true, force: true })
  })

  it('lists the install directory root', () => {
    const { path: listedPath, entries } = listFileBrowserEntries(installDir, '')
    expect(listedPath).toBe('')
    expect(entries).toEqual(
      expect.arrayContaining([
        { name: 'ShooterGame', isDir: true, size: expect.any(Number), mtime: expect.any(Number) },
        { name: 'root-file.txt', isDir: false, size: 5, mtime: expect.any(Number) }
      ])
    )
  })

  it('lists a subfolder', () => {
    const { entries } = listFileBrowserEntries(installDir, 'ShooterGame/Saved/Config')
    expect(entries).toEqual([{ name: 'Test.ini', isDir: false, size: expect.any(Number), mtime: expect.any(Number) }])
  })

  it('rejects a path that escapes the install directory', () => {
    expect(() => listFileBrowserEntries(installDir, '../../etc')).toThrow('Invalid path')
  })

  it('resolveFileBrowserPath returns the absolute path inside installDir', () => {
    expect(resolveFileBrowserPath(installDir, 'root-file.txt')).toBe(path.join(installDir, 'root-file.txt'))
  })

  it('deletes a file', () => {
    deleteFileBrowserFile(installDir, 'root-file.txt')
    expect(fs.existsSync(path.join(installDir, 'root-file.txt'))).toBe(false)
  })

  it('refuses to delete a folder', () => {
    expect(() => deleteFileBrowserFile(installDir, 'ShooterGame')).toThrow('Only files can be deleted here, not folders.')
    expect(fs.existsSync(path.join(installDir, 'ShooterGame'))).toBe(true)
  })
})

describe('fileBrowser - raw .ini editor + history/diff/restore', () => {
  let installDir: string
  let profileId: string
  const iniRelativePath = 'ShooterGame/Saved/Config/Test.ini'

  beforeEach(() => {
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-browser-ini-test-'))
    fs.mkdirSync(path.join(installDir, 'ShooterGame', 'Saved', 'Config'), { recursive: true })
    fs.writeFileSync(path.join(installDir, iniRelativePath), '[Test]\nFoo=Bar\n')
    // Fresh random id per test (not a fixed literal) - these go into the real on-disk store,
    // which persists across runs, same reasoning as the "resilience" tests in store.test.ts.
    profileId = randomUUID()
  })

  afterEach(() => {
    fs.rmSync(installDir, { recursive: true, force: true })
  })

  it('reads the raw content of a .ini file', () => {
    expect(readIniFile(installDir, iniRelativePath)).toBe('[Test]\nFoo=Bar\n')
  })

  it('rejects reading a file whose extension is not ini/json/log', () => {
    fs.writeFileSync(path.join(installDir, 'root-file.txt'), 'hello')
    expect(() => readIniFile(installDir, 'root-file.txt')).toThrow(
      'Only .ini, .json, and .log files can be opened here.'
    )
  })

  it('reads a .json file (opening does not require writability)', () => {
    fs.writeFileSync(path.join(installDir, 'config.json'), '{"a":1}')
    expect(readIniFile(installDir, 'config.json')).toBe('{"a":1}')
  })

  it('reads a .log file, which is openable but not editable', () => {
    fs.writeFileSync(path.join(installDir, 'ShooterGame.log'), 'log content')
    expect(readIniFile(installDir, 'ShooterGame.log')).toBe('log content')
  })

  it('writes new content and snapshots the previous content into history', () => {
    writeIniFile(profileId, installDir, iniRelativePath, '[Test]\nFoo=Changed\n')
    expect(readIniFile(installDir, iniRelativePath)).toBe('[Test]\nFoo=Changed\n')

    const history = listIniHistory(profileId, iniRelativePath)
    expect(history).toHaveLength(1)
  })

  it('does not fail writing a brand-new file with nothing to snapshot', () => {
    writeIniFile(profileId, installDir, 'ShooterGame/Saved/Config/New.ini', '[New]\n')
    expect(readIniFile(installDir, 'ShooterGame/Saved/Config/New.ini')).toBe('[New]\n')
    expect(listIniHistory(profileId, 'ShooterGame/Saved/Config/New.ini')).toHaveLength(0)
  })

  it('rejects writing a .log file - it may still be live-written by a running server', () => {
    expect(() => writeIniFile(profileId, installDir, 'ShooterGame.log', 'nope')).toThrow(
      'Only .ini and .json files can be saved here.'
    )
  })

  it('writes and reads back a .json file, with history too', () => {
    writeIniFile(profileId, installDir, 'config.json', '{"a":1}')
    expect(readIniFile(installDir, 'config.json')).toBe('{"a":1}')
    writeIniFile(profileId, installDir, 'config.json', '{"a":2}')
    expect(listIniHistory(profileId, 'config.json')).toHaveLength(1)
  })

  it('diffs a history entry against the current file content', () => {
    writeIniFile(profileId, installDir, iniRelativePath, '[Test]\nFoo=Changed\n')
    const entry = listIniHistory(profileId, iniRelativePath)[0]

    expect(diffIniHistoryEntry(profileId, installDir, entry.id)).toEqual([
      { type: 'same', text: '[Test]' },
      { type: 'removed', text: 'Foo=Bar' },
      { type: 'added', text: 'Foo=Changed' },
      { type: 'same', text: '' }
    ])
  })

  it('throws "Unknown history entry" for a bogus entry id', () => {
    expect(() => diffIniHistoryEntry(profileId, installDir, 'does-not-exist')).toThrow('Unknown history entry')
    expect(() => restoreIniHistoryEntry(profileId, installDir, 'does-not-exist')).toThrow('Unknown history entry')
  })

  it("throws for another profile's history entry even with a valid id", () => {
    writeIniFile(profileId, installDir, iniRelativePath, '[Test]\nFoo=Changed\n')
    const entry = listIniHistory(profileId, iniRelativePath)[0]
    expect(() => diffIniHistoryEntry(randomUUID(), installDir, entry.id)).toThrow('Unknown history entry')
  })

  it('restores a historical revision, snapshotting the pre-restore content first', () => {
    writeIniFile(profileId, installDir, iniRelativePath, '[Test]\nFoo=Changed\n')
    const entry = listIniHistory(profileId, iniRelativePath)[0]

    restoreIniHistoryEntry(profileId, installDir, entry.id)
    expect(readIniFile(installDir, iniRelativePath)).toBe('[Test]\nFoo=Bar\n')
    expect(listIniHistory(profileId, iniRelativePath)).toHaveLength(2)
  })
})
