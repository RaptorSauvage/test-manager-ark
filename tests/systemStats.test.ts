import { describe, expect, it, vi } from 'vitest'
import { combineCpuModel } from '../src/main/lib/systemStats'

const { mockNetworkStats } = vi.hoisted(() => ({ mockNetworkStats: vi.fn() }))
vi.mock('systeminformation', () => ({ default: { networkStats: mockNetworkStats } }))

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

describe('getNetworkUsage', () => {
  it('reads rx/tx bytes-per-sec off the default interface sample', async () => {
    const { getNetworkUsage } = await import('../src/main/lib/systemStats')
    mockNetworkStats.mockResolvedValueOnce([{ iface: 'eth0', rx_sec: 2048, tx_sec: 1024 }])
    expect(await getNetworkUsage()).toEqual({ rxBytesPerSec: 2048, txBytesPerSec: 1024 })
  })

  it('reports null (not 0) for a rate systeminformation has not computed yet', async () => {
    const { getNetworkUsage } = await import('../src/main/lib/systemStats')
    mockNetworkStats.mockResolvedValueOnce([{ iface: 'eth0', rx_sec: null, tx_sec: null }])
    expect(await getNetworkUsage()).toEqual({ rxBytesPerSec: null, txBytesPerSec: null })
  })

  it('falls back to nulls when no interface sample comes back at all', async () => {
    const { getNetworkUsage } = await import('../src/main/lib/systemStats')
    mockNetworkStats.mockResolvedValueOnce([])
    expect(await getNetworkUsage()).toEqual({ rxBytesPerSec: null, txBytesPerSec: null })
  })
})
