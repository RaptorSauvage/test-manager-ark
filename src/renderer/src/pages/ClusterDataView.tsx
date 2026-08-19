import { useEffect, useRef, useState } from 'react'
import type { ServerProfile } from '@shared/types'
import { useServerStatuses } from '../lib/useServerStatuses'
import { computeClusterGroupStats, type ClusterGroupStats } from '../lib/clusterStats'
import { appendSample, selectHistoryWindow, type StatSample } from '../lib/sparkline'
import ServerStatsChart from './ServerDetail/ServerStatsChart'

interface ClusterDataViewProps {
  profiles: ServerProfile[]
  onOpenGroup: (groupName: string, profiles: ServerProfile[]) => void
}

/** Same collection/sampling cadence as the per-server Analytics tab's Server Statistics
 *  chart - up to 1h collected regardless of the selected scale, sampled every 5s. */
const STATS_HISTORY_WINDOW_MS = 60 * 60 * 1000
const STATS_SAMPLE_INTERVAL_MS = 5000
const STATS_TIME_SCALES: Array<{ label: string; ms: number }> = [
  { label: '1m', ms: 60 * 1000 },
  { label: '5m', ms: 5 * 60 * 1000 },
  { label: '30m', ms: 30 * 60 * 1000 },
  { label: '1h', ms: 60 * 60 * 1000 }
]

const STATS_SCALE_KEY = 'cluster-data-stats-scale'

function historyKey(group: string): string {
  return `cluster-data-history:${group || '(ungrouped)'}`
}

function loadStoredHistory(group: string): StatSample[] {
  try {
    const raw = localStorage.getItem(historyKey(group))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return selectHistoryWindow(parsed as StatSample[], STATS_HISTORY_WINDOW_MS, Date.now())
  } catch {
    return []
  }
}

function saveStoredHistory(group: string, history: StatSample[]): void {
  localStorage.setItem(historyKey(group), JSON.stringify(history))
}

function loadStoredScale(): number {
  const raw = localStorage.getItem(STATS_SCALE_KEY)
  const parsed = raw !== null ? Number(raw) : NaN
  return STATS_TIME_SCALES.some((scale) => scale.ms === parsed) ? parsed : STATS_TIME_SCALES[1].ms
}

/**
 * One row per dashboard group (same grouping as the Dashboard page), each showing that
 * group's servers summed together - total CPU/memory/players across whichever of its
 * servers are currently running - plus a Server Statistics chart identical in behavior to
 * the per-server Analytics tab's, just fed the group's summed samples instead of one
 * server's raw ones. Clicking a row opens a merged live log console for that group (see
 * GroupConsoleView). Hidden servers are excluded, matching the Dashboard.
 */
export default function ClusterDataView({ profiles, onOpenGroup }: ClusterDataViewProps): JSX.Element {
  const visibleIds = profiles.filter((p) => !p.hidden).map((p) => p.id)
  const statuses = useServerStatuses(visibleIds)
  const groupStats = computeClusterGroupStats(profiles, statuses)
  const [now, setNow] = useState(() => Date.now())
  const [statsScale, setStatsScale] = useState(() => loadStoredScale())
  const [historyByGroup, setHistoryByGroup] = useState<Record<string, StatSample[]>>({})
  const profilesRef = useRef(profiles)
  profilesRef.current = profiles
  const statusesRef = useRef(statuses)
  statusesRef.current = statuses

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      const currentGroups = computeClusterGroupStats(profilesRef.current, statusesRef.current)
      setHistoryByGroup((prev) => {
        const next = { ...prev }
        for (const g of currentGroups) {
          // Nothing running in this group right now - same as the per-server Analytics
          // tab skipping a sample while its own server is stopped, there's nothing live to
          // record, and recording a flat 0 would misrepresent the group as merely idle
          // instead of fully down.
          if (g.runningCount === 0) continue
          const sample: StatSample = {
            time: Date.now(),
            cpu: g.totalCpu,
            memoryMB: g.totalMemoryMB,
            players: g.totalPlayers
          }
          const updated = appendSample(next[g.group] ?? loadStoredHistory(g.group), sample, STATS_HISTORY_WINDOW_MS)
          next[g.group] = updated
          saveStoredHistory(g.group, updated)
        }
        return next
      })
    }, STATS_SAMPLE_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  function selectStatsScale(ms: number): void {
    setStatsScale(ms)
    localStorage.setItem(STATS_SCALE_KEY, String(ms))
  }

  function historyFor(g: ClusterGroupStats): StatSample[] {
    return historyByGroup[g.group] ?? loadStoredHistory(g.group)
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
                key={scale.ms}
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
                {g.runningCount > 0 && history.length > 0 && (
                  <div className="cluster-data-chart" onClick={(e) => e.stopPropagation()}>
                    <ServerStatsChart
                      history={history}
                      maxPlayers={Math.max(g.totalMaxPlayers, 1)}
                      windowMs={statsScale}
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
