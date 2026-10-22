import si from 'systeminformation'
import type { SystemStaticInfo } from '@shared/types'

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

/** CPU model/core-count, total system RAM/module type, and the primary network interface's
 *  name/speed - fetched once and cached for the whole Manager session, never re-polled.
 *
 *  This used to also expose a live, host-wide CPU/RAM/network *usage* snapshot (re-queried
 *  every few seconds for the Dashboard's hardware stats bar), but a real report found that
 *  polling `systeminformation`'s live stats that often made antivirus software (Malwarebytes,
 *  specifically) flag the Manager for repeatedly spawning OS query processes (WMI/PowerShell
 *  on Windows) in the background - exactly the pattern AV heuristics watch for. The
 *  Dashboard's hardware stats bar now shows the *managed ARK servers'* own CPU/RAM usage
 *  instead (already pushed to the renderer via server status events, so it costs nothing
 *  extra to poll), and only asks this module for the one-time static info below. */
let staticInfoCache: SystemStaticInfo | null = null

export async function getSystemStaticInfo(): Promise<SystemStaticInfo> {
  if (staticInfoCache) return staticInfoCache

  const [cpu, mem, memLayout, defaultIface, netIfaces] = await Promise.all([
    si.cpu(),
    si.mem().catch(() => ({ total: 0 })),
    si.memLayout().catch(() => []),
    si.networkInterfaceDefault().catch(() => ''),
    si.networkInterfaces().catch(() => [])
  ])

  const firstModule = Array.isArray(memLayout) ? memLayout.find((m) => m.type) : undefined

  const ifaceList = Array.isArray(netIfaces) ? netIfaces : []
  const primaryIface =
    ifaceList.find((n) => n.iface === defaultIface) ?? ifaceList.find((n) => !n.internal && n.operstate === 'up')

  staticInfoCache = {
    cpuModel: combineCpuModel(cpu.manufacturer ?? '', cpu.brand ?? ''),
    physicalCores: typeof cpu.physicalCores === 'number' ? cpu.physicalCores : null,
    logicalCores: cpu.cores ?? 0,
    totalMemoryBytes: mem.total ?? 0,
    memoryType: firstModule?.type || null,
    memorySpeedMHz: firstModule?.clockSpeed || null,
    networkInterfaceLabel: primaryIface?.ifaceName || primaryIface?.iface || null,
    networkSpeedMbps: primaryIface?.speed || null
  }
  return staticInfoCache
}
