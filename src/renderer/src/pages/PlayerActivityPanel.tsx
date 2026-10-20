import { useEffect, useState } from 'react'
import type { PlayerActivityRecord, PlayerActivitySession, ServerProfile } from '@shared/types'

interface PlayerActivityPanelProps {
  profiles: ServerProfile[]
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

/** Aggregated playtime per player (ARK only), merged across every server - see
 *  PlayerActivityRecord's own doc comment for why this doesn't cover Minecraft. Read-only:
 *  there's nothing to ban/unban or add/remove here, just collected activity data, so unlike
 *  PlayerBansPanel/WatchedPlayersSection this has no form at all. */
export default function PlayerActivityPanel({ profiles }: PlayerActivityPanelProps): JSX.Element {
  const [records, setRecords] = useState<PlayerActivityRecord[]>([])
  const [sessions, setSessions] = useState<PlayerActivitySession[]>([])

  useEffect(() => {
    window.api.playerActivity.list().then(setRecords)
    window.api.playerActivity.sessions().then(setSessions)
  }, [])

  function profileName(id: string): string {
    return profiles.find((p) => p.id === id)?.name ?? id
  }

  const sorted = [...records].sort((a, b) => b.totalPlaytimeMs - a.totalPlaytimeMs)

  return (
    <>
      <section className="cluster-section">
        <h3>Total playtime ({sorted.length})</h3>
        {sorted.length === 0 ? (
          <p className="empty-state">
            No activity recorded yet - enable &quot;Track player activity/playtime&quot; in Settings &gt; General.
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Total playtime</th>
                <th>Sessions</th>
                <th>Servers</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((record) => (
                <tr key={record.id}>
                  <td>{record.name}</td>
                  <td>{formatDuration(record.totalPlaytimeMs)}</td>
                  <td>{record.sessionCount}</td>
                  <td>{record.profileIds.map(profileName).join(', ')}</td>
                  <td>{new Date(record.lastSeenAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="cluster-section">
        <h3>Recent sessions ({sessions.length})</h3>
        {sessions.length === 0 ? (
          <p className="empty-state">No sessions recorded yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Server</th>
                <th>Joined</th>
                <th>Left</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id}>
                  <td>{session.playerName}</td>
                  <td>{profileName(session.profileId)}</td>
                  <td>{new Date(session.joinedAt).toLocaleString()}</td>
                  <td>{new Date(session.leftAt).toLocaleString()}</td>
                  <td>{formatDuration(session.leftAt - session.joinedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}
