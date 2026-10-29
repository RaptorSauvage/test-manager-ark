import si from 'systeminformation'
import type { NetworkUsage, SystemStaticInfo } from '@shared/types'

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

/** The raw `iface` identifier (not the display-friendly `networkInterfaceLabel` above) of the
 *  interface getSystemStaticInfo() resolved - cached alongside it so getNetworkUsage() below
 *  can explicitly pass the same one to si.networkStats() instead of letting it re-derive its
 *  own default internally (see that function's own doc comment for why that matters). Stays
 *  null if resolution found nothing at all, same as networkInterfaceLabel in that case. */
let primaryNetworkIfaceCache: string | null = null

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

  primaryNetworkIfaceCache = primaryIface?.iface || null

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

/** Live upload/download throughput for the machine's default network interface, in
 *  bytes/sec - re-introduces the exact background-query pattern the doc comment above
 *  warns about (on Windows, `systeminformation` shells out to read the interface's
 *  counters), so the Dashboard polls this on a noticeably slower interval than the old
 *  (removed) 3s one that got flagged, trading off freshness for fewer spawned processes.
 *  `rx_sec`/`tx_sec` are null until a second sample can be compared against the first.
 *
 *  Explicitly passes the interface getSystemStaticInfo() already resolved (with its fallback
 *  to any non-internal "up" interface when the OS-reported default doesn't match a known
 *  one) rather than calling si.networkStats() with no argument, which re-derives its own
 *  default internally and has no such fallback. On a machine with more than one active
 *  network adapter (a VPN client, a virtual adapter from WSL/Docker/Hyper-V, ...) that
 *  internal detection can land on a different interface than the one actually resolved -
 *  one with nothing real to report - which left this permanently returning null (shown as
 *  "-" on the Dashboard) even though the static info above displayed a sensible interface
 *  name. getSystemStaticInfo() is cheap to call again here (cached after its first run), and
 *  best-effort if it fails for an unrelated reason (e.g. si.cpu() throwing) - this still
 *  falls back to si.networkStats()'s own default-interface detection rather than failing
 *  network usage entirely over an unrelated field. */
export async function getNetworkUsage(): Promise<NetworkUsage> {
  try {
    await getSystemStaticInfo()
  } catch {
    // best-effort, see doc comment above
  }
  const [sample] = primaryNetworkIfaceCache ? await si.networkStats(primaryNetworkIfaceCache) : await si.networkStats()
  return {
    rxBytesPerSec: sample?.rx_sec ?? null,
    txBytesPerSec: sample?.tx_sec ?? null
  }
}
