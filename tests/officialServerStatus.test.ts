import { describe, expect, it } from 'vitest'
import { guessIsUp, parseOfficialServerStatus } from '../src/main/lib/officialServerStatus'

describe('parseOfficialServerStatus', () => {
  it('parses sections into a nested section -> key -> value map', () => {
    const content = `
[status]
prod_asaa_us_east=1
prod_asaa_us_west=0

[maintenance]
scheduled=false
`
    expect(parseOfficialServerStatus(content)).toEqual({
      status: { prod_asaa_us_east: '1', prod_asaa_us_west: '0' },
      maintenance: { scheduled: 'false' }
    })
  })

  it('flattens keys that appear before any section under "general"', () => {
    const content = `prod_asaa_us_east=1\n[status]\nother=0`
    const result = parseOfficialServerStatus(content)
    expect(result.general).toEqual({ prod_asaa_us_east: '1' })
    expect(result.status).toEqual({ other: '0' })
  })

  it('returns an empty object for empty content', () => {
    expect(parseOfficialServerStatus('')).toEqual({})
  })
})

describe('guessIsUp', () => {
  it('recognizes common "up" values', () => {
    expect(guessIsUp('1')).toBe(true)
    expect(guessIsUp('true')).toBe(true)
    expect(guessIsUp('Online')).toBe(true)
  })

  it('recognizes common "down" values', () => {
    expect(guessIsUp('0')).toBe(false)
    expect(guessIsUp('false')).toBe(false)
    expect(guessIsUp('Offline')).toBe(false)
  })

  it('returns undefined for anything else', () => {
    expect(guessIsUp('maintenance')).toBeUndefined()
  })
})
