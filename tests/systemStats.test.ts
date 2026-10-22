import { describe, expect, it } from 'vitest'
import { combineCpuModel } from '../src/main/lib/systemStats'

describe('combineCpuModel', () => {
  it('prefixes the manufacturer when brand does not already include it', () => {
    expect(combineCpuModel('AMD', 'Ryzen 9 7950X3D 16-Core Processor')).toBe(
      'AMD Ryzen 9 7950X3D 16-Core Processor'
    )
  })

  it('does not duplicate the manufacturer when brand already starts with it', () => {
    expect(combineCpuModel('AMD', 'AMD Ryzen 9 7950X3D')).toBe('AMD Ryzen 9 7950X3D')
  })

  it('is case-insensitive when checking for an existing manufacturer prefix', () => {
    expect(combineCpuModel('Intel', 'intel Core i9-13900K')).toBe('intel Core i9-13900K')
  })

  it('falls back to just the brand when manufacturer is empty', () => {
    expect(combineCpuModel('', 'Apple M3 Pro')).toBe('Apple M3 Pro')
  })

  it("falls back to 'Unknown CPU' when both are empty", () => {
    expect(combineCpuModel('', '')).toBe('Unknown CPU')
  })

  it('trims whitespace from both inputs', () => {
    expect(combineCpuModel('  AMD  ', '  Ryzen 9 7950X3D  ')).toBe('AMD Ryzen 9 7950X3D')
  })
})
