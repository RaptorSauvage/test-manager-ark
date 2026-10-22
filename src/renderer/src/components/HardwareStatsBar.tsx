import { useEffect, useState } from 'react'
import type { SystemStats } from '@shared/types'

const POLL_INTERVAL_MS = 3000

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}

function formatRate(bytesPerSec: number): string {
  return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
}

function formatLinkSpeed(speedMbps: number): string {
  return speedMbps >= 1000 ? `${(speedMbps / 1000).toFixed(speedMbps % 1000 === 0 ? 0 : 1)} Gbps` : `${speedMbps} Mbps`
}

/** Host-wide CPU/RAM/network usage - distinct from the Dashboard sidebar's own "Global
 *  Performance" panel, which only sums this app's own managed server processes. Polls
 *  system.getStats() (src/main/lib/systemStats.ts, backed by the `systeminformation`
 *  package) every few seconds. Renders nothing until the first sample lands, rather than an
 *  empty-looking row of cards for the ~hundred ms that takes. */
export default function HardwareStatsBar(): JSX.Element | null {
  const [stats, setStats] = useState<SystemStats | null>(null)

  useEffect(() => {
    let cancelled = false
    function refresh(): void {
      window.api.systemStats
        .get()
        .then((s) => {
          if (!cancelled) setStats(s)
        })
        .catch(() => {
          // Best-effort - a single failed sample just leaves the last known values on
          // screen until the next poll succeeds, same as the rest of the Dashboard's
          // own live-polled panels.
        })
    }
    refresh()
    const interval = setInterval(refresh, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  if (!stats) return null

  const memType = stats.memory.type
    ? `${stats.memory.type}${stats.memory.speedMHz ? ` ${stats.memory.speedMHz} MHz` : ''}`
    : null

  const netBytesPerSec = stats.network.rxBytesPerSec + stats.network.txBytesPerSec
  const netSpeedBytesPerSec = stats.network.speedMbps ? (stats.network.speedMbps * 1_000_000) / 8 : null
  const netPercent = netSpeedBytesPerSec ? Math.min((netBytesPerSec / netSpeedBytesPerSec) * 100, 100) : 0

  return (
    <div className="hw-stats-row">
      <div className="hw-card">
        <div className="hw-card-top">
          <div className="hw-icon">🧠</div>
          <div>
            <div className="hw-card-label">CPU Usage</div>
            <div className="hw-card-value">{stats.cpu.usagePercent.toFixed(1)}%</div>
          </div>
        </div>
        <div className="hw-bar">
          <div
            className="hw-bar-fill"
            style={{ width: `${Math.min(stats.cpu.usagePercent, 100)}%`, background: 'var(--accent)' }}
          />
        </div>
        <div className="hw-card-sub">
          {stats.cpu.physicalCores
            ? `${stats.cpu.physicalCores} Cores / ${stats.cpu.logicalCores} Threads`
            : `${stats.cpu.logicalCores} Threads`}{' '}
          • {stats.cpu.model}
        </div>
      </div>

      <div className="hw-card">
        <div className="hw-card-top">
          <div className="hw-icon">💾</div>
          <div>
            <div className="hw-card-label">Memory Usage</div>
            <div className="hw-card-value">{stats.memory.usagePercent.toFixed(1)}%</div>
          </div>
        </div>
        <div className="hw-bar">
          <div
            className="hw-bar-fill"
            style={{ width: `${Math.min(stats.memory.usagePercent, 100)}%`, background: 'var(--ok)' }}
          />
        </div>
        <div className="hw-card-sub">
          {formatBytes(stats.memory.usedBytes)} / {formatBytes(stats.memory.totalBytes)}
          {memType ? ` • ${memType}` : ''}
        </div>
      </div>

      <div className="hw-card">
        <div className="hw-card-top">
          <div className="hw-icon">🌐</div>
          <div>
            <div className="hw-card-label">Network Usage</div>
            <div className="hw-card-value">
              ↑{formatRate(stats.network.txBytesPerSec)} ↓{formatRate(stats.network.rxBytesPerSec)}
            </div>
          </div>
        </div>
        <div className="hw-bar">
          <div className="hw-bar-fill" style={{ width: `${netPercent}%`, background: 'var(--cyan)' }} />
        </div>
        <div className="hw-card-sub">
          {stats.network.interfaceLabel ?? 'Unknown interface'}
          {stats.network.speedMbps ? ` • ${formatLinkSpeed(stats.network.speedMbps)}` : ''}
        </div>
      </div>
    </div>
  )
}
