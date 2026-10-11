import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  queryAwsStatus,
  queryCloudflareStatus,
  queryEosStatus,
  queryOfficialNetworkStatus,
  queryXboxStatus,
  queryMinecraftAuthStatus
} from '../src/bot/externalStatus'

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
