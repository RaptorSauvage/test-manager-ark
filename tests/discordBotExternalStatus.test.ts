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

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

/** A response whose body is really UTF-8-encoded bytes (the normal case, and what every
 *  test before this file's UTF-16LE rewrite used a plain JS string literal to approximate -
 *  going through a real TextEncoder here instead is a more faithful test of the actual byte
 *  decoding path in `readResponseText`). */
function fakeTextResponse(text: string): Response {
  return { arrayBuffer: async () => toArrayBuffer(Buffer.from(text, 'utf-8')) } as unknown as Response
}

/** A response whose body is really UTF-16LE-encoded bytes, with or without a BOM - this is
 *  the actual shape a real AWS Health response turned out to have (confirmed from a user's
 *  own diagnostic log showing a 0x00 byte after every ASCII character), which no amount of
 *  guessing about leading BOM characters on an already-UTF-8-decoded string could ever have
 *  caught - the previous two fix attempts were chasing symptoms of this real cause. */
function fakeUtf16LeResponse(text: string, withBom: boolean): Response {
  const body = Buffer.from(text, 'utf16le')
  const bytes = withBom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body
  return { arrayBuffer: async () => toArrayBuffer(bytes) } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('queryAwsStatus', () => {
  it('parses a genuinely UTF-16LE-encoded response with a BOM', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeUtf16LeResponse('[]', true)))
    const [line, severity] = await queryAwsStatus()
    expect(line).toContain('Opérationnel')
    expect(severity).toBe(0)
  })

  it('parses a genuinely UTF-16LE-encoded response with no BOM at all - the exact shape confirmed from a real AWS response', async () => {
    const events = [{ region_name: 'eu-west-1' }]
    vi.stubGlobal('fetch', vi.fn(async () => fakeUtf16LeResponse(JSON.stringify(events), false)))
    const [line, severity] = await queryAwsStatus()
    expect(line).toContain('1 incident')
    expect(line).toContain('eu-west-1')
  })

  it('parses a response even when it starts with a UTF-8 BOM', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeTextResponse('﻿[]')))
    const [line, severity] = await queryAwsStatus()
    expect(line).toContain('Opérationnel')
    expect(severity).toBe(0)
  })

  it('parses a response with *two* leading UTF-8 BOMs in a row - the first real capture of this bug showed this shape', async () => {
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
    // into unreadable mojibake more than once while diagnosing a real AWS parse failure -
    // asserting on the literal numeric code point (65533 = U+FFFD) sidesteps that entirely,
    // unlike asserting on the character itself which this very test file's own source
    // encoding could just as easily get mangled on.
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

  it('also works against a genuinely UTF-16LE-encoded response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeUtf16LeResponse('<html>text > Online (v92.28) <text</html>', false)))
    const [line, severity] = await queryOfficialNetworkStatus()
    expect(line).toContain('En ligne')
    expect(severity).toBe(0)
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
