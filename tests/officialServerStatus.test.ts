import { describe, expect, it } from 'vitest'
import { parseOfficialServerStatus, richColorToCss } from '../src/main/lib/officialServerStatus'

describe('parseOfficialServerStatus', () => {
  it('parses the real feed format into label/status/version/color', () => {
    const content = 'ARK Official Server Network Status: <RichColor Color="0, 1, 0, 1">Online (v92.25)</>'
    expect(parseOfficialServerStatus(content)).toEqual({
      label: 'ARK Official Server Network Status',
      status: 'Online',
      version: '92.25',
      color: 'rgb(0, 255, 0)'
    })
  })

  it('tolerates surrounding whitespace/newlines', () => {
    const content = '\n  ARK Official Server Network Status: <RichColor Color="1, 0, 0, 1">Offline (v92.25)</>  \n'
    expect(parseOfficialServerStatus(content)).toEqual({
      label: 'ARK Official Server Network Status',
      status: 'Offline',
      version: '92.25',
      color: 'rgb(255, 0, 0)'
    })
  })

  it('throws a clear error for content that does not match the known format', () => {
    expect(() => parseOfficialServerStatus('not the expected format')).toThrow(/Unrecognized/)
  })
})

describe('richColorToCss', () => {
  it('converts 0-1 float components (alpha 1) into a plain rgb()', () => {
    expect(richColorToCss('0, 1, 0, 1')).toBe('rgb(0, 255, 0)')
  })

  it('converts a partial alpha into rgba()', () => {
    expect(richColorToCss('1, 1, 0, 0.5')).toBe('rgba(255, 255, 0, 0.5)')
  })

  it('clamps out-of-range components', () => {
    expect(richColorToCss('-1, 2, 0.5, 1')).toBe('rgb(0, 255, 128)')
  })
})
