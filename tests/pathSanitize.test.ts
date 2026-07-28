import { describe, expect, it } from 'vitest'
import { stripWrappingQuotes } from '../src/main/lib/pathSanitize'

describe('stripWrappingQuotes', () => {
  it('strips a wrapping pair of double quotes, as pasted from Explorer\'s "Copy as path"', () => {
    expect(stripWrappingQuotes('"C:\\ARK\\Server"')).toBe('C:\\ARK\\Server')
  })

  it('trims surrounding whitespace even without quotes', () => {
    expect(stripWrappingQuotes('  C:\\ARK\\Server  ')).toBe('C:\\ARK\\Server')
  })

  it('trims whitespace outside the quotes too', () => {
    expect(stripWrappingQuotes('  "C:\\ARK\\Server"  ')).toBe('C:\\ARK\\Server')
  })

  it('leaves an unquoted path untouched', () => {
    expect(stripWrappingQuotes('C:\\ARK\\Server')).toBe('C:\\ARK\\Server')
  })

  it('leaves a lone quote character untouched rather than stripping to nothing', () => {
    expect(stripWrappingQuotes('"')).toBe('"')
  })

  it('leaves an empty string untouched', () => {
    expect(stripWrappingQuotes('')).toBe('')
  })

  it('does not strip a quote that only appears on one side', () => {
    expect(stripWrappingQuotes('"C:\\ARK\\Server')).toBe('"C:\\ARK\\Server')
    expect(stripWrappingQuotes('C:\\ARK\\Server"')).toBe('C:\\ARK\\Server"')
  })
})
