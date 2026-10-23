import { useEffect, useState } from 'react'
import type { NetworkUsage, SystemStaticInfo } from '@shared/types'
import cpuIcon from '../assets/icons/cpu.png'
import ramIcon from '../assets/icons/ram.png'
import networkIcon from '../assets/icons/network.png'

// Deliberately far above the old (removed) 3s poll that got the Manager flagged by
// antivirus software for repeatedly spawning background OS queries - see
// getNetworkUsage()'s own doc comment in src/main/lib/systemStats.ts. Unlike CPU/RAM below,
// this one genuinely has to poll something every time, so it trades off freshness for fewer
// spawned processes instead.
const NETWORK_POLL_INTERVAL_MS = 8000

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}

function formatRate(bytesPerSec: number | null): string {
  if (bytesPerSec === null) return '-'
  const mb = bytesPerSec / 1024 ** 2
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`
  return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
}

function formatLinkSpeed(speedMbps: number): string {
  return speedMbps >= 1000 ? `${(speedMbps / 1000).toFixed(speedMbps % 1000 === 0 ? 0 : 1)} Gbps` : `${speedMbps} Mbps`
}

/** Deliberately loose/duck-typed rather than importing ServerProfile/ServerStatus (ARK) or
 *  MinecraftProfile/MinecraftServerStatus - this bar is shared by both Dashboards, and all
 *  it actually needs from either is an id to key statuses by, plus each status's own
 *  cpu/memoryMB (both games already shape these fields identically). */
interface HardwareStatsBarProps {
  profiles: { id: string }[]
  statuses: Record<string, { cpu?: number; memoryMB?: number }>
  /** e.g. "ARK Servers" or "Minecraft Servers" - prefixed onto the CPU/Memory card labels so
   *  it's clear those two numbers are scoped to this Dashboard's own servers specifically
   *  (unlike the Network card, which is host-wide either way). */
  labelPrefix: string
  /** Fetched once in App.tsx (not here) and passed down - this component gets freshly
   *  mounted every time its owning Dashboard does (e.g. navigating to a server's own detail
   *  view and back), and fetching this one-time static info locally meant it reset to null
   *  and had to re-fetch on every single visit, a visible flash from the placeholder subtext
   *  back to the real one each time. */
  staticInfo: SystemStaticInfo | null
}

/** CPU/RAM used by this Manager's own running ARK servers, not the whole machine - a real
 *  report found that polling `systeminformation`'s live host-wide usage every few seconds
 *  (the first version of this bar) made Windows antivirus software flag the Manager for
 *  repeatedly spawning OS query processes in the background. These numbers instead come
 *  straight from `statuses` (already pushed from the main process via server status events,
 *  same as every other live card on the Dashboard), so there's nothing new to poll at all -
 *  only the static machine info (CPU model, total RAM) is fetched at all, once, in App.tsx
 *  (see `staticInfo`'s own doc comment above for why it isn't fetched here instead). */
export default function HardwareStatsBar({ profiles, statuses, labelPrefix, staticInfo }: HardwareStatsBarProps): JSX.Element | null {
  const [networkUsage, setNetworkUsage] = useState<NetworkUsage>({ rxBytesPerSec: null, txBytesPerSec: null })

  useEffect(() => {
    let cancelled = false
    function poll(): void {
      window.api.systemStats
        .getNetworkUsage()
        .then((usage) => {
          if (!cancelled) setNetworkUsage(usage)
        })
        .catch(() => {
          // Best-effort - a single failed sample just leaves the last known numbers on
          // screen until the next poll succeeds.
        })
    }
    poll()
    const interval = setInterval(poll, NETWORK_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  // Each server's own cpu% is process-style (100% = one fully-busy thread, so a handful of
  // servers can sum past 100 on a many-core machine) - rescale that sum against every thread
  // the CPU has so 100% here means "every thread this machine has is saturated," matching how
  // Task Manager reads overall CPU usage, instead of a number that's meaningless without
  // knowing the core count.
  const totalCpu = profiles.reduce((sum, p) => sum + (statuses[p.id]?.cpu ?? 0), 0)
  const cpuCapacityPercent = staticInfo?.logicalCores
    ? Math.min(totalCpu / staticInfo.logicalCores, 100)
    : Math.min(totalCpu, 100)
  const totalMemoryBytes = profiles.reduce((sum, p) => sum + (statuses[p.id]?.memoryMB ?? 0) * 1024 ** 2, 0)
  const memoryPercent =
    staticInfo?.totalMemoryBytes ? Math.min((totalMemoryBytes / staticInfo.totalMemoryBytes) * 100, 100) : 0

  // Host-wide, unlike CPU/RAM above - there's no reliable way to attribute network I/O to
  // one process on Windows without much heavier tooling (see getNetworkUsage()'s own doc
  // comment), so this reflects the whole machine's link, not just the managed ARK servers'.
  const linkBytesPerSec = staticInfo?.networkSpeedMbps ? (staticInfo.networkSpeedMbps * 1_000_000) / 8 : null
  const uploadPercent =
    linkBytesPerSec && networkUsage.txBytesPerSec !== null
      ? Math.min((networkUsage.txBytesPerSec / linkBytesPerSec) * 100, 100)
      : 0
  const downloadPercent =
    linkBytesPerSec && networkUsage.rxBytesPerSec !== null
      ? Math.min((networkUsage.rxBytesPerSec / linkBytesPerSec) * 100, 100)
      : 0

  return (
    <div className="hw-stats-row">
      <div className="hw-card">
        <div className="hw-card-top">
          <div className="hw-icon">
            <img src={cpuIcon} alt="" />
          </div>
          <div>
            <div className="hw-card-label">{labelPrefix} - CPU</div>
            <div className="hw-card-value">{cpuCapacityPercent.toFixed(1)}%</div>
          </div>
        </div>
        <div className="hw-bar">
          <div className="hw-bar-fill" style={{ width: `${cpuCapacityPercent}%`, background: 'var(--accent)' }} />
        </div>
        <div className="hw-card-sub">
          {staticInfo
            ? `${staticInfo.physicalCores ? `${staticInfo.physicalCores} Cores / ${staticInfo.logicalCores} Threads` : `${staticInfo.logicalCores} Threads`} • ${staticInfo.cpuModel}`
            : 'Summed across every running server'}
        </div>
      </div>

      <div className="hw-card">
        <div className="hw-card-top">
          <div className="hw-icon">
            <img src={ramIcon} alt="" />
          </div>
          <div>
            <div className="hw-card-label">{labelPrefix} - Memory</div>
            <div className="hw-card-value">{formatBytes(totalMemoryBytes)}</div>
          </div>
        </div>
        <div className="hw-bar">
          <div className="hw-bar-fill" style={{ width: `${memoryPercent}%`, background: 'var(--ok)' }} />
        </div>
        <div className="hw-card-sub">
          {staticInfo
            ? `${memoryPercent.toFixed(1)}% of ${formatBytes(staticInfo.totalMemoryBytes)} total RAM`
            : 'Summed across every running server'}
        </div>
      </div>

      <div className="hw-card">
        <div className="hw-card-top">
          <div className="hw-icon network">
            <span
              className="icon-mask"
              style={{ WebkitMaskImage: `url("${networkIcon}")`, maskImage: `url("${networkIcon}")` }}
            />
          </div>
          <div>
            <div className="hw-card-label">Network Usage</div>
            <div className="hw-net-values">
              <span>&uarr; {formatRate(networkUsage.txBytesPerSec)}</span>
              <span>&darr; {formatRate(networkUsage.rxBytesPerSec)}</span>
            </div>
          </div>
        </div>
        <div className="hw-bar">
          <div className="hw-bar-fill" style={{ width: `${uploadPercent}%`, background: 'var(--purple)' }} />
        </div>
        <div className="hw-bar">
          <div className="hw-bar-fill" style={{ width: `${downloadPercent}%`, background: 'var(--cyan)' }} />
        </div>
        <div className="hw-card-sub">
          {staticInfo?.networkInterfaceLabel
            ? `${staticInfo.networkInterfaceLabel}${staticInfo.networkSpeedMbps ? ` • ${formatLinkSpeed(staticInfo.networkSpeedMbps)}` : ''}`
            : 'This machine\'s network link, not just the managed servers\''}
        </div>
      </div>
    </div>
  )
}
