import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readMapDefinitionsFile } from '../src/main/lib/jsonListFile'

describe('readMapDefinitionsFile', () => {
  let tmpDir: string
  let filePath: string
  const defaults = [{ id: 'TheIsland', displayName: 'The Island' }]

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-list-file-test-'))
    filePath = path.join(tmpDir, 'maps.json')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates the file from defaults on first run and returns them', () => {
    const result = readMapDefinitionsFile(filePath, 'maps.json', defaults)
    expect(result).toEqual(defaults)
    expect(fs.existsSync(filePath)).toBe(true)
  })

  it('reads back a previously-written file', () => {
    fs.writeFileSync(filePath, JSON.stringify([{ id: 'Ragnarok', displayName: 'Ragnarok' }]))
    expect(readMapDefinitionsFile(filePath, 'maps.json', defaults)).toEqual([{ id: 'Ragnarok', displayName: 'Ragnarok' }])
  })

  it('falls back to defaults instead of throwing when creating the file fails on a fresh run', () => {
    // A real report on Windows showed disk-level failures across this app - creating
    // maps.json on its very first run must not crash whatever asked for the map list.
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw Object.assign(new Error('unknown error, write'), { code: 'UNKNOWN', errno: -4094 })
    })
    try {
      expect(readMapDefinitionsFile(filePath, 'maps.json', defaults)).toEqual(defaults)
    } finally {
      spy.mockRestore()
    }
  })

  it('falls back to defaults instead of throwing when reading an existing file fails', () => {
    fs.writeFileSync(filePath, JSON.stringify([{ id: 'Ragnarok', displayName: 'Ragnarok' }]))
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw Object.assign(new Error('unknown error, read'), { code: 'UNKNOWN', errno: -4094 })
    })
    try {
      expect(readMapDefinitionsFile(filePath, 'maps.json', defaults)).toEqual(defaults)
    } finally {
      spy.mockRestore()
    }
  })
})
