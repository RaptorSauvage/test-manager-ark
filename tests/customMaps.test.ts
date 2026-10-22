import { describe, expect, it, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { mockDataDir } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('node:os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('node:path')
  return { mockDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'custom-maps-datadir-')) }
})
vi.mock('../src/main/lib/dataDir', () => ({ getDataDir: () => mockDataDir }))

import {
  getDefaultCustomMaps,
  parseCustomMapsFile,
  getCustomMapsFilePath,
  listCustomMaps,
  addCustomMap,
  updateCustomMap,
  deleteCustomMap
} from '../src/main/lib/customMaps'

describe('getDefaultCustomMaps', () => {
  it('seeds an empty list - custom maps are entirely user-added', () => {
    expect(getDefaultCustomMaps()).toEqual([])
  })
})

describe('parseCustomMapsFile', () => {
  it('parses a valid custom maps array', () => {
    const json = JSON.stringify([{ id: 'MyCustomMap_WP', displayName: 'My Modded Map' }])
    expect(parseCustomMapsFile(json)).toEqual([{ id: 'MyCustomMap_WP', displayName: 'My Modded Map' }])
  })

  it('rejects invalid JSON', () => {
    expect(() => parseCustomMapsFile('not json')).toThrow(/not valid JSON/)
  })

  it('rejects a JSON value that is not an array', () => {
    expect(() => parseCustomMapsFile('{"id": "MyCustomMap_WP"}')).toThrow(/must contain a JSON array/)
  })

  it('rejects an entry missing id or displayName', () => {
    expect(() => parseCustomMapsFile(JSON.stringify([{ id: 'MyCustomMap_WP' }]))).toThrow(/entry 0/)
  })

  it('accepts an empty array', () => {
    expect(parseCustomMapsFile('[]')).toEqual([])
  })

  it('preserves an optional modId', () => {
    const json = JSON.stringify([{ id: 'CrystalIsles_WP', displayName: 'Crystal Isles', modId: '929480' }])
    expect(parseCustomMapsFile(json)).toEqual([{ id: 'CrystalIsles_WP', displayName: 'Crystal Isles', modId: '929480' }])
  })
})

describe('addCustomMap/updateCustomMap/deleteCustomMap', () => {
  afterEach(() => {
    fs.rmSync(path.dirname(getCustomMapsFilePath()), { recursive: true, force: true })
    fs.mkdirSync(mockDataDir, { recursive: true })
  })

  it('adds a new custom map and persists it to disk', () => {
    const result = addCustomMap({ id: 'CrystalIsles_WP', displayName: 'Crystal Isles' })
    expect(result).toEqual([{ id: 'CrystalIsles_WP', displayName: 'Crystal Isles' }])
    expect(listCustomMaps()).toEqual(result)
  })

  it('keeps an optional modId when provided', () => {
    const result = addCustomMap({ id: 'CrystalIsles_WP', displayName: 'Crystal Isles', modId: '929480' })
    expect(result).toEqual([{ id: 'CrystalIsles_WP', displayName: 'Crystal Isles', modId: '929480' }])
  })

  it('rejects a blank id or display name', () => {
    expect(() => addCustomMap({ id: '  ', displayName: 'Crystal Isles' })).toThrow(/id and a display name/)
    expect(() => addCustomMap({ id: 'CrystalIsles_WP', displayName: '  ' })).toThrow(/id and a display name/)
  })

  it('rejects a duplicate id', () => {
    addCustomMap({ id: 'CrystalIsles_WP', displayName: 'Crystal Isles' })
    expect(() => addCustomMap({ id: 'CrystalIsles_WP', displayName: 'Again' })).toThrow(/already exists/)
  })

  it('updates an existing custom map in place, including renaming its id', () => {
    addCustomMap({ id: 'CrystalIsles_WP', displayName: 'Crystal Isles' })
    const result = updateCustomMap('CrystalIsles_WP', { id: 'CrystalIsles2_WP', displayName: 'Crystal Isles II', modId: '1' })
    expect(result).toEqual([{ id: 'CrystalIsles2_WP', displayName: 'Crystal Isles II', modId: '1' }])
  })

  it('rejects updating a map that does not exist', () => {
    expect(() => updateCustomMap('NoSuchMap', { id: 'NoSuchMap', displayName: 'X' })).toThrow(/No custom map/)
  })

  it('rejects renaming a map onto an id already used by a different map', () => {
    addCustomMap({ id: 'MapA', displayName: 'A' })
    addCustomMap({ id: 'MapB', displayName: 'B' })
    expect(() => updateCustomMap('MapA', { id: 'MapB', displayName: 'A' })).toThrow(/already exists/)
  })

  it('deletes a custom map by id, and is a no-op if already gone', () => {
    addCustomMap({ id: 'MapA', displayName: 'A' })
    expect(deleteCustomMap('MapA')).toEqual([])
    expect(deleteCustomMap('MapA')).toEqual([])
  })
})
