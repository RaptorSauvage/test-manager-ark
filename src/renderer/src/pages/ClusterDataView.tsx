import { useEffect, useRef, useState } from 'react'
import type { ServerProfile, StatSample } from '@shared/types'
import { useServerStatuses } from '../lib/useServerStatuses'
import { computeClusterGroupStats, type ClusterGroupStats } from '../lib/clusterStats'
import { STATS_TIME_SCALES, STATS_DEFAULT_SCALE_MS, loadStoredScale, saveStoredScale } from '../lib/sparkline'
import ServerStatsChart from './ServerDetail/ServerStatsChart'

interface ClusterDataViewProps {
  profiles: ServerProfile[]
  onOpenGroup: (groupName: string, profiles: ServerProfile[]) => void
}

/** How often the chart re-fetches each group's persisted history while this page is open. */
const STATS_POLL_INTERVAL_MS = 5000
/** How many points to ask for per group - the main process downsamples to this on read. */
const STATS_MAX_POINTS = 500

const STATS_SCALE_KEY = 'cluster-data-stats-scale'

/**
 * One row per dashboard group (same grouping as the Dashboard page), each showing that
 * group's servers summed together - total CPU/memory/players across whichever of its
 * servers are currently running - plus a Server Statistics chart identical in behavior to
 * the per-server Analytics tab's, fed that group's persisted history (summed across its
 * servers - see src/main/lib/statsHistory.ts's readClusterStatsHistory) instead of one
 * server's raw samples. Only servers with stats enabled (Analytics tab) contribute to a
 * group's chart. Clicking a row opens a merged live log console for that group (see
 * GroupConsoleView). Hidden servers are excluded, matching the Dashboard.
 */
export default function ClusterDataView({ profiles, onOpenGroup }: ClusterDataViewProps): JSX.Element {
  const visibleIds = profiles.filter((p) => !p.hidden).map((p) => p.id)
  const statuses = useServerStatuses(visibleIds)
  const groupStats = computeClusterGroupStats(profiles, statuses)
  const [now, setNow] = useState(() => Date.now())
  const [statsScale, setStatsScale] = useState(() => loadStoredScale(STATS_SCALE_KEY, STATS_DEFAULT_SCALE_MS))
  const [historyByGroup, setHistoryByGroup] = useState<Record<string, StatSample[]>>({})
  const profilesRef = useRef(profiles)
  profilesRef.current = profiles

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function refresh(): Promise<void> {
      const byGroup = new Map<string, string[]>()
      for (const p of profilesRef.current) {
        if (p.hidden) continue
        const key = p.group.trim()
        const ids = byGroup.get(key) ?? []
        ids.push(p.id)
        byGroup.set(key, ids)
      }
      const sinceMs = statsScale === null ? null : Date.now() - statsScale
      const entries = await Promise.all(
        Array.from(byGroup.entries()).map(async ([group, ids]) => {
          const history = await window.api.statsHistory.getForGroup(ids, sinceMs, STATS_MAX_POINTS)
          return [group, history] as const
        })
      )
      if (!cancelled) setHistoryByGroup(Object.fromEntries(entries))
    }
    refresh()
    const interval = setInterval(refresh, STATS_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [statsScale])

  function selectStatsScale(ms: number | null): void {
    setStatsScale(ms)
    saveStoredScale(STATS_SCALE_KEY, ms)
  }

  function historyFor(g: ClusterGroupStats): StatSample[] {
    return historyByGroup[g.group] ?? []
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Cluster Dashboard</h1>
        {groupStats.length > 0 && (
          <div className="time-scale-selector">
            <span>Time Scale</span>
            {STATS_TIME_SCALES.map((scale) => (
              <button
                key={scale.label}
                type="button"
                className={`time-scale-btn${scale.ms === statsScale ? ' active' : ''}`}
                onClick={() => selectStatsScale(scale.ms)}
              >
                {scale.label}
              </button>
            ))}
          </div>
        )}
      </header>
      {groupStats.length === 0 ? (
        <p className="empty-state">No servers yet - add one from the Dashboard.</p>
      ) : (
        <div className="cluster-data-list">
          {groupStats.map((g) => {
            const history = historyFor(g)
            // The chart is fed persisted history, which only ever contains samples from
            // profiles with Stats collection enabled (Analytics tab) - a live-running
            // profile with it off never contributes a single sample, so the chart (and its
            // "current" numbers, drawn from that same history) can legitimately sit well
            // below the live totals above with no bug involved. Surfacing the gap here
            // turns a confusing mismatch into an explained, actionable one.
            const statsRunningCount = g.profiles.filter(
              (p) => statuses[p.id]?.state === 'running' && p.statsEnabled
            ).length
            return (
              <div
                className="cluster-data-row clickable"
                key={g.group || '(ungrouped)'}
                onClick={() => onOpenGroup(g.group, g.profiles)}
              >
                <div className="cluster-data-row-header">
                  <h3>{g.group || 'Ungrouped'}</h3>
                  <span className="cluster-data-row-sub">
                    {g.runningCount} / {g.serverCount} running
                  </span>
                </div>
                <div className="cluster-data-stats">
                  <div className="cluster-data-stat">
                    <span>CPU</span>
                    <strong>{g.totalCpu.toFixed(1)}%</strong>
                  </div>
                  <div className="cluster-data-stat">
                    <span>Memory</span>
                    <strong>{g.totalMemoryMB} MB</strong>
                  </div>
                  <div className="cluster-data-stat">
                    <span>Players</span>
                    <strong>
                      {g.totalPlayers} / {g.totalMaxPlayers}
                    </strong>
                  </div>
                </div>
                {history.length > 0 && (
                  <div className="cluster-data-chart" onClick={(e) => e.stopPropagation()}>
                    {statsRunningCount < g.runningCount && (
                      <p className="cluster-data-chart-note">
                        Chart reflects {statsRunningCount} of {g.runningCount} running servers - the rest have
                        stats collection off (Analytics tab), so the totals above will read higher than the chart.
                      </p>
                    )}
                    <ServerStatsChart
                      history={history}
                      windowMs={statsScale ?? Math.max(1, now - history[0].time)}
                      now={now}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
