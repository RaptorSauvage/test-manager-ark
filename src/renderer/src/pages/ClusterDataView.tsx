import type { ServerProfile } from '@shared/types'
import { useServerStatuses } from '../lib/useServerStatuses'
import { computeClusterGroupStats } from '../lib/clusterStats'

interface ClusterDataViewProps {
  profiles: ServerProfile[]
}

/**
 * One row per dashboard group (same grouping as the Dashboard page), each showing that
 * group's servers summed together - total CPU/memory/players across whichever of its
 * servers are currently running. Hidden servers are excluded, matching the Dashboard.
 */
export default function ClusterDataView({ profiles }: ClusterDataViewProps): JSX.Element {
  const visibleIds = profiles.filter((p) => !p.hidden).map((p) => p.id)
  const statuses = useServerStatuses(visibleIds)
  const groupStats = computeClusterGroupStats(profiles, statuses)

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Cluster Data</h1>
      </header>
      {groupStats.length === 0 ? (
        <p className="empty-state">No servers yet - add one from the Dashboard.</p>
      ) : (
        <div className="cluster-data-list">
          {groupStats.map((g) => (
            <div className="cluster-data-row" key={g.group || '(ungrouped)'}>
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
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
