import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  allArkMaintenanceIds,
  allMcMaintenanceIds,
  getArkMaintenance,
  getMcMaintenance,
  initMaintenanceState,
  isBotMaintenanceMode,
  isCheckDisabled,
  setArkMaintenance,
  setBotMaintenanceMode,
  setCheckDisabled,
  setMcMaintenance
} from '../src/bot/maintenanceState'

// This module's state is plain in-memory module-level Maps/Sets (deliberately not
// persisted - see its own doc comment), so every test must reset it afterwards or leave
// something behind for the next test file in the same worker.
afterEach(() => {
  for (const id of allArkMaintenanceIds()) setArkMaintenance(id, null)
  for (const id of allMcMaintenanceIds()) setMcMaintenance(id, null)
  setCheckDisabled('server-1', false)
  setBotMaintenanceMode(false)
})

describe('maintenanceState', () => {
  it('has no maintenance entries by default', () => {
    expect(getArkMaintenance('server-1')).toBeUndefined()
    expect(getMcMaintenance('server-1')).toBeUndefined()
  })

  it('sets and clears ARK maintenance independently from Minecraft', () => {
    setArkMaintenance('server-1', { reason: 'Mise à jour' })
    expect(getArkMaintenance('server-1')).toEqual({ reason: 'Mise à jour' })
    expect(getMcMaintenance('server-1')).toBeUndefined()

    setArkMaintenance('server-1', null)
    expect(getArkMaintenance('server-1')).toBeUndefined()
  })

  it('tracks maintenance without a reason', () => {
    setMcMaintenance('server-2', {})
    expect(getMcMaintenance('server-2')).toEqual({})
    setMcMaintenance('server-2', null)
  })

  it('toggles check-disabled per server id', () => {
    expect(isCheckDisabled('server-1')).toBe(false)
    setCheckDisabled('server-1', true)
    expect(isCheckDisabled('server-1')).toBe(true)
    setCheckDisabled('server-1', false)
    expect(isCheckDisabled('server-1')).toBe(false)
  })

  it('tracks the bot-wide maintenance flag', () => {
    expect(isBotMaintenanceMode()).toBe(false)
    setBotMaintenanceMode(true)
    expect(isBotMaintenanceMode()).toBe(true)
    setBotMaintenanceMode(false)
    expect(isBotMaintenanceMode()).toBe(false)
  })
})

describe('disabled-servers persistence', () => {
  it('survives a simulated bot restart (initMaintenanceState reloads from disk)', () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-bot-maintenance-test-'))
    initMaintenanceState(stateDir)

    setCheckDisabled('server-x', true)
    expect(isCheckDisabled('server-x')).toBe(true)
    expect(fs.existsSync(path.join(stateDir, 'disabled_servers.json'))).toBe(true)

    // Simulates a bot restart: a fresh process would call initMaintenanceState again,
    // which must reload what was persisted rather than starting from an empty set.
    initMaintenanceState(stateDir)
    expect(isCheckDisabled('server-x')).toBe(true)

    setCheckDisabled('server-x', false)
    initMaintenanceState(stateDir)
    expect(isCheckDisabled('server-x')).toBe(false)
  })

  it('starts with an empty set when there is nothing on disk yet', () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-bot-maintenance-test-'))
    initMaintenanceState(stateDir)
    expect(isCheckDisabled('anything')).toBe(false)
  })

  it('ignores a malformed state file instead of crashing', () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-bot-maintenance-test-'))
    fs.writeFileSync(path.join(stateDir, 'disabled_servers.json'), '{not valid json', 'utf-8')
    expect(() => initMaintenanceState(stateDir)).not.toThrow()
    expect(isCheckDisabled('anything')).toBe(false)
  })
})
