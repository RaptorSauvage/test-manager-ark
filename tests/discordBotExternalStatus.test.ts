import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  queryAwsStatus,
  queryCloudflareStatus,
  queryEosStatus,
  queryOfficialNetworkStatus,
  queryXboxStatus,
  queryMinecraftAuthStatus
} from '../src/bot/externalStatus'
import { log } from '../src/bot/logging'

function fakeTextResponse(text: string): Response {
  return { text: async () => text, read: async () => undefined } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('queryAwsStatus', () => {
  it('parses a response even when it starts with a UTF-8 BOM - confirmed against the real endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeTextResponse('﻿[]')))
    const [line, severity] = await queryAwsStatus()
    expect(line).toContain('Opérationnel')
    expect(severity).toBe(0)
  })

  it('parses a response with *two* leading BOM-like characters - a real capture showed this, and stripping only one still broke JSON.parse', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeTextResponse('﻿﻿[]')))
    const [line, severity] = await queryAwsStatus()
    expect(line).toContain('Opérationnel')
    expect(severity).toBe(0)
  })

  it('parses a response prefixed with arbitrary junk, not just a BOM', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeTextResponse('��some garbage[]')))
    const [line, severity] = await queryAwsStatus()
    expect(line).toContain('Opérationnel')
    expect(severity).toBe(0)
  })

  it('reports incidents outside the Middle East, ignoring the noisy region', async () => {
    const events = [{ region_name: 'eu-west-1' }, { region_name: 'me-south-1' }]
    vi.stubGlobal('fetch', vi.fn(async () => fakeTextResponse(JSON.stringify(events))))
    const [line, severity] = await queryAwsStatus()
    expect(line).toContain('1 incident')
    expect(line).toContain('eu-west-1')
    expect(line).not.toContain('me-south-1')
    expect(severity).toBe(1)
  })

  it('falls back to an unavailable status instead of throwing on malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeTextResponse('not json')))
    const [line, severity] = await queryAwsStatus()
    expect(line).toContain('indisponible')
    expect(severity).toBe(1)
  })

  it('logs an unambiguous, console-encoding-proof diagnostic (exact preview + code points) on a parse failure', async () => {
    // Regression guard for this exact saga: a terminal's own encoding mangled the raw text
    // into unreadable mojibake twice while diagnosing a real AWS parse failure - asserting
    // on the literal numeric code point (65533 = U+FFFD) sidesteps that entirely, unlike
    // asserting on the character itself which this very test file's own source encoding
    // could just as easily get mangled on.
    const warnSpy = vi.spyOn(log, 'warn')
    vi.stubGlobal('fetch', vi.fn(async () => fakeTextResponse('��notjson')))
    await queryAwsStatus()
    const message = warnSpy.mock.calls[0][0] as string
    expect(message).toContain('aperçu exact:')
    expect(message).toContain('codes des 20 premiers caractères:')
    expect(message).toContain('65533')
    warnSpy.mockRestore()
  })
})

describe('queryEosStatus', () => {
  it('parses a BOM-prefixed response the same way', async () => {
    const body = JSON.stringify({ components: [{ id: 'zwclljjbtmfs', status: 'operational' }] })
    vi.stubGlobal('fetch', vi.fn(async () => fakeTextResponse(`﻿${body}`)))
    const [line, severity] = await queryEosStatus()
    expect(line).toContain('Opérationnel')
    expect(severity).toBe(0)
  })
})

describe('queryCloudflareStatus', () => {
  it('parses a BOM-prefixed response the same way', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeTextResponse('﻿{"incidents":[]}')))
    const [line, severity] = await queryCloudflareStatus()
    expect(line).toContain('Opérationnel')
    expect(severity).toBe(0)
  })
})

describe('queryOfficialNetworkStatus', () => {
  it('reports Hors ligne only for the exact "Offline" keyword', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeTextResponse('<html>text > Offline (v92.28) <text</html>')))
    const [line, severity] = await queryOfficialNetworkStatus()
    expect(line).toContain('Hors ligne')
    expect(severity).toBe(2)
  })
})

describe('queryXboxStatus and queryMinecraftAuthStatus', () => {
  it('report operational on a plain successful response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeTextResponse('all good')))
    expect((await queryXboxStatus())[0]).toContain('Opérationnel')
    expect((await queryMinecraftAuthStatus())[0]).toContain('Opérationnel')
  })

  it('report unreachable instead of throwing on a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      })
    )
    expect((await queryXboxStatus())[0]).toContain('indisponible')
    expect((await queryMinecraftAuthStatus())[0]).toContain('Injoignable')
  })
})
