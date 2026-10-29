import { beforeEach, describe, expect, it, vi } from 'vitest'
import { combineCpuModel } from '../src/main/lib/systemStats'

const { mockNetworkStats, mockCpu, mockMem, mockMemLayout, mockNetworkInterfaceDefault, mockNetworkInterfaces } = vi.hoisted(
  () => ({
    mockNetworkStats: vi.fn(),
    mockCpu: vi.fn(),
    mockMem: vi.fn(),
    mockMemLayout: vi.fn(),
    mockNetworkInterfaceDefault: vi.fn(),
    mockNetworkInterfaces: vi.fn()
  })
)
vi.mock('systeminformation', () => ({
  default: {
    networkStats: mockNetworkStats,
    cpu: mockCpu,
    mem: mockMem,
    memLayout: mockMemLayout,
    networkInterfaceDefault: mockNetworkInterfaceDefault,
    networkInterfaces: mockNetworkInterfaces
  }
}))

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
  // getSystemStaticInfo() caches its result at module scope - a fresh module instance per
  // test (via resetModules + a dynamic re-import) keeps that cache, and therefore which
  // interface getNetworkUsage() resolves to, from leaking between tests.
  beforeEach(() => {
    vi.resetModules()
    mockCpu.mockReset().mockResolvedValue({ manufacturer: 'AMD', brand: 'Ryzen 9', cores: 8, physicalCores: 4 })
    mockMem.mockReset().mockResolvedValue({ total: 1024 })
    mockMemLayout.mockReset().mockResolvedValue([])
    mockNetworkInterfaceDefault.mockReset().mockResolvedValue('eth0')
    mockNetworkInterfaces
      .mockReset()
      .mockResolvedValue([{ iface: 'eth0', ifaceName: 'eth0', internal: false, operstate: 'up', speed: 1000 }])
    mockNetworkStats.mockReset()
  })

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

  it('passes the interface getSystemStaticInfo() resolved, instead of letting si.networkStats() re-derive its own default', async () => {
    const { getNetworkUsage } = await import('../src/main/lib/systemStats')
    mockNetworkStats.mockResolvedValueOnce([{ iface: 'eth0', rx_sec: 100, tx_sec: 50 }])
    await getNetworkUsage()
    expect(mockNetworkStats).toHaveBeenCalledWith('eth0')
  })

  it('falls back to si.networkStats() with no argument when no interface could be resolved at all', async () => {
    mockNetworkInterfaceDefault.mockReset().mockResolvedValue('')
    mockNetworkInterfaces.mockReset().mockResolvedValue([])
    const { getNetworkUsage } = await import('../src/main/lib/systemStats')
    mockNetworkStats.mockResolvedValueOnce([])
    await getNetworkUsage()
    expect(mockNetworkStats).toHaveBeenCalledWith()
  })

  it('still resolves network usage (via the no-argument fallback) when an unrelated static info field fails, e.g. si.cpu() throwing', async () => {
    mockCpu.mockReset().mockRejectedValue(new Error('wmi unavailable'))
    const { getNetworkUsage } = await import('../src/main/lib/systemStats')
    mockNetworkStats.mockResolvedValueOnce([{ iface: 'eth0', rx_sec: 777, tx_sec: 333 }])
    expect(await getNetworkUsage()).toEqual({ rxBytesPerSec: 777, txBytesPerSec: 333 })
    expect(mockNetworkStats).toHaveBeenCalledWith()
  })
})
