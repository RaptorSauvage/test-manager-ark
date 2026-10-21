import { describe, expect, it } from 'vitest'
import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js'
import { isUnknownMessageError } from '../src/bot/statusRefresh'

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
