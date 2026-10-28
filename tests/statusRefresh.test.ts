import { describe, expect, it, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js'
import type { Client } from 'discord.js'
import type { DiscordBotConfig } from '@shared/discordBot'
import { isUnknownMessageError, updateBotPresence } from '../src/bot/statusRefresh'
import { initMaintenanceState } from '../src/bot/maintenanceState'

function makeUnknownMessageError(): DiscordAPIError {
  return new DiscordAPIError(
    { message: 'Unknown Message', code: RESTJSONErrorCodes.UnknownMessage },
    RESTJSONErrorCodes.UnknownMessage,
    404,
    'PATCH',
    '/channels/1/messages/2',
    {}
  )
}

describe('isUnknownMessageError', () => {
  it('is true for a real "Unknown Message" DiscordAPIError (the message was deleted)', () => {
    expect(isUnknownMessageError(makeUnknownMessageError())).toBe(true)
  })

  it('is false for a different DiscordAPIError code, e.g. Missing Permissions', () => {
    const err = new DiscordAPIError(
      { message: 'Missing Permissions', code: RESTJSONErrorCodes.MissingPermissions },
      RESTJSONErrorCodes.MissingPermissions,
      403,
      'PATCH',
      '/channels/1/messages/2',
      {}
    )
    expect(isUnknownMessageError(err)).toBe(false)
  })

  it('is false for a transient network error (the actual bug this guards against) - a Connect Timeout is not a DiscordAPIError at all', () => {
    expect(isUnknownMessageError(new Error('Connect Timeout Error (attempted address: discord.com:443, timeout: 10000ms)'))).toBe(
      false
    )
  })

  it('is false for a non-Error value', () => {
    expect(isUnknownMessageError('not an error')).toBe(false)
    expect(isUnknownMessageError(null)).toBe(false)
    expect(isUnknownMessageError(undefined)).toBe(false)
  })
})

function makeConfig(overrides: Partial<DiscordBotConfig> = {}): DiscordBotConfig {
  return {
    discordToken: '',
    stateDir: '',
    managerApiUrl: '',
    managerApiTimeoutMs: 10_000,
    refreshSeconds: 60,
    statusEmbedTitle: '',
    statusEmbedDescription: '',
    statusEmbedColor: '9B59B6',
    arkCheckEnabled: true,
    mcRefreshSeconds: 60,
    mcStatusEmbedTitle: '',
    mcStatusEmbedDescription: '',
    mcStatusEmbedColor: '9B59B6',
    mcCheckEnabled: true,
    presenceEnabled: true,
    chatBridgeEnabled: true,
    maintenanceWhitelistIds: [],
    managerWhitelistIds: [],
    groupOrder: [],
    minecraftGroupOrder: [],
    curseforge: { apiKey: '', moduleEnabled: false, defaultModIds: [], checkIntervalMinutes: 10 },
    ...overrides
  }
}

function makeFakeClient(): { client: Client; setActivity: ReturnType<typeof vi.fn> } {
  const setActivity = vi.fn()
  const client = { user: { username: 'TestBot', setActivity } } as unknown as Client
  return { client, setActivity }
}

describe('updateBotPresence', () => {
  beforeEach(() => {
    // isBotMaintenanceMode()/getArkMaintenance() (both used by updateBotPresence when
    // presenceEnabled is on) read from a real state dir - a fresh one per test keeps them
    // both at their "nothing in maintenance" defaults.
    initMaintenanceState(fs.mkdtempSync(path.join(os.tmpdir(), 'bot-presence-test-')))
  })

  it('sets an activity reflecting the current server count when presenceEnabled is on', async () => {
    const { client, setActivity } = makeFakeClient()
    await updateBotPresence(client, makeConfig({ presenceEnabled: true }))
    expect(setActivity).toHaveBeenCalledTimes(1)
    expect(setActivity).toHaveBeenCalledWith(expect.stringContaining('survivant'), expect.anything())
  })

  it('clears any existing activity (calls setActivity with no arguments) instead of setting one when presenceEnabled is off', async () => {
    const { client, setActivity } = makeFakeClient()
    await updateBotPresence(client, makeConfig({ presenceEnabled: false }))
    expect(setActivity).toHaveBeenCalledTimes(1)
    expect(setActivity).toHaveBeenCalledWith()
  })
})
