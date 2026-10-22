import si from 'systeminformation'
import type { SystemStats } from '@shared/types'

interface StaticInfo {
  cpu: { model: string; physicalCores: number | null; logicalCores: number }
  memoryType: { type: string | null; speedMHz: number | null }
  network: { iface: string | null; interfaceLabel: string | null; speedMbps: number | null }
}

/** Some platforms already fold the manufacturer into `si.cpu()`'s own `brand` (e.g. "AMD
 *  Ryzen 9 7950X3D"), others don't (brand "Ryzen 9 7950X3D", manufacturer "AMD" reported
 *  separately) - only prefixes the manufacturer when brand doesn't already start with it,
 *  so the model name shown on the Dashboard never ends up duplicated either way. */
export function combineCpuModel(manufacturer: string, brand: string): string {
  const trimmedBrand = brand.trim()
  const trimmedManufacturer = manufacturer.trim()
  if (trimmedManufacturer && !trimmedBrand.toLowerCase().startsWith(trimmedManufacturer.toLowerCase())) {
    return `${trimmedManufacturer} ${trimmedBrand}`.trim()
  }
  return trimmedBrand || 'Unknown CPU'
}

/** CPU model/core-count, RAM module type/speed, and which network interface is the "primary"
 *  one rarely (if ever) change while the Manager is running - fetched once and cached, so
 *  only the genuinely live numbers (currentLoad, mem usage, network throughput) are
 *  re-queried on every poll from HardwareStatsBar. */
let staticInfoCache: StaticInfo | null = null

async function getStaticInfo(): Promise<StaticInfo> {
  if (staticInfoCache) return staticInfoCache

  const [cpu, memLayout, defaultIface, netIfaces] = await Promise.all([
    si.cpu(),
    si.memLayout().catch(() => []),
    si.networkInterfaceDefault().catch(() => ''),
    si.networkInterfaces().catch(() => [])
  ])

  const model = combineCpuModel(cpu.manufacturer ?? '', cpu.brand ?? '')

  const firstModule = Array.isArray(memLayout) ? memLayout.find((m) => m.type) : undefined

  const ifaceList = Array.isArray(netIfaces) ? netIfaces : []
  const primaryIface = ifaceList.find((n) => n.iface === defaultIface) ?? ifaceList.find((n) => !n.internal && n.operstate === 'up')

  staticInfoCache = {
    cpu: {
      model,
      physicalCores: typeof cpu.physicalCores === 'number' ? cpu.physicalCores : null,
      logicalCores: cpu.cores ?? 0
    },
    memoryType: {
      type: firstModule?.type || null,
      speedMHz: firstModule?.clockSpeed || null
    },
    network: {
      iface: primaryIface?.iface ?? null,
      interfaceLabel: primaryIface?.ifaceName || primaryIface?.iface || null,
      speedMbps: primaryIface?.speed || null
    }
  }
  return staticInfoCache
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** Live system-wide CPU/RAM/network snapshot for the Dashboard's hardware stats bar - this
 *  is genuinely host-wide usage (like a system task manager), not the sum of this app's own
 *  managed server processes (that's the separate, pre-existing "Global Performance" panel). */
export async function getSystemStats(): Promise<SystemStats> {
  const [staticInfo, load, mem, netStats] = await Promise.all([
    getStaticInfo(),
    si.currentLoad().catch(() => ({ currentLoad: 0 })),
    si.mem().catch(() => ({ total: 0, active: 0 })),
    si.networkStats().catch(() => [])
  ])

  const primaryNet = Array.isArray(netStats)
    ? (netStats.find((n) => n.iface === staticInfo.network.iface) ?? netStats[0])
    : undefined

  return {
    cpu: {
      usagePercent: round1(load.currentLoad ?? 0),
      model: staticInfo.cpu.model,
      physicalCores: staticInfo.cpu.physicalCores,
      logicalCores: staticInfo.cpu.logicalCores
    },
    memory: {
      usagePercent: mem.total ? round1((mem.active / mem.total) * 100) : 0,
      usedBytes: mem.active ?? 0,
      totalBytes: mem.total ?? 0,
      type: staticInfo.memoryType.type,
      speedMHz: staticInfo.memoryType.speedMHz
    },
    network: {
      interfaceLabel: staticInfo.network.interfaceLabel,
      speedMbps: staticInfo.network.speedMbps,
      rxBytesPerSec: primaryNet?.rx_sec ?? 0,
      txBytesPerSec: primaryNet?.tx_sec ?? 0
    }
  }
}
