import { useEffect, useState } from 'react'
import type { ServerProfile, ServerStatus, SystemStaticInfo } from '@shared/types'
import cpuIcon from '../assets/icons/cpu.png'
import ramIcon from '../assets/icons/ram.png'

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}

interface HardwareStatsBarProps {
  profiles: ServerProfile[]
  statuses: Record<string, ServerStatus>
}

/** CPU/RAM used by this Manager's own running ARK servers, not the whole machine - a real
 *  report found that polling `systeminformation`'s live host-wide usage every few seconds
 *  (the first version of this bar) made Windows antivirus software flag the Manager for
 *  repeatedly spawning OS query processes in the background. These numbers instead come
 *  straight from `statuses` (already pushed from the main process via server status events,
 *  same as every other live card on the Dashboard), so there's nothing new to poll at all -
 *  only the static machine info (CPU model, total RAM) is fetched, once, from
 *  system.getStats(). */
export default function HardwareStatsBar({ profiles, statuses }: HardwareStatsBarProps): JSX.Element | null {
  const [staticInfo, setStaticInfo] = useState<SystemStaticInfo | null>(null)

  useEffect(() => {
    window.api.systemStats
      .get()
      .then(setStaticInfo)
      .catch(() => {
        // Best-effort - the bar just renders without the "16 Cores / 32 Threads • ..." and
        // "X GB total RAM" context lines if this one-time fetch fails.
      })
  }, [])

  const totalCpu = profiles.reduce((sum, p) => sum + (statuses[p.id]?.cpu ?? 0), 0)
  const totalMemoryBytes = profiles.reduce((sum, p) => sum + (statuses[p.id]?.memoryMB ?? 0) * 1024 ** 2, 0)
  const memoryPercent =
    staticInfo?.totalMemoryBytes ? Math.min((totalMemoryBytes / staticInfo.totalMemoryBytes) * 100, 100) : 0

  return (
    <div className="hw-stats-row">
      <div className="hw-card">
        <div className="hw-card-top">
          <div className="hw-icon">
            <img src={cpuIcon} alt="" />
          </div>
          <div>
            <div className="hw-card-label">ARK Servers - CPU</div>
            <div className="hw-card-value">{totalCpu.toFixed(1)}%</div>
          </div>
        </div>
        <div className="hw-bar">
          <div className="hw-bar-fill" style={{ width: `${Math.min(totalCpu, 100)}%`, background: 'var(--accent)' }} />
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
            <div className="hw-card-label">ARK Servers - Memory</div>
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
    </div>
  )
}
