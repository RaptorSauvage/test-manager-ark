import { useEffect, useState } from 'react'
import type { ServerProfile, PlayerRosterEntry } from '@shared/types'
import { confirmAction } from '../lib/confirmAction'

interface PlayerRosterPanelProps {
  profiles: ServerProfile[]
}

const REFRESH_INTERVAL_MS = 15_000

/** Every server's live connected-player list at once, straight from RCON ListPlayers - one
 *  card per server (rather than a single-server picker) so the whole cluster's current
 *  occupancy is visible in one glance, refreshed on a short timer while this panel's open.
 *  Unlike PlayerBansPanel/PlayerActivityPanel (the Manager's own merged, persisted records
 *  across every server), this never persists anything by itself - it's just who's online
 *  right now. Kick/Ban/Add-to-whitelist act directly on a row - the same actions the web
 *  dashboard's own player context menu already offers, just inline buttons instead of a
 *  right-click menu. */
export default function PlayerRosterPanel({ profiles }: PlayerRosterPanelProps): JSX.Element {
  const [rosters, setRosters] = useState<Record<string, PlayerRosterEntry[]>>({})
  const [rosterErrors, setRosterErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')

  function loadAll(): void {
    if (profiles.length === 0) return
    setLoading(true)
    Promise.all(
      profiles.map((p) =>
        window.api.playerRoster
          .list(p.id)
          .then((roster) => ({ id: p.id, roster, error: '' }))
          .catch((err) => ({ id: p.id, roster: [] as PlayerRosterEntry[], error: (err as Error).message }))
      )
    ).then((results) => {
      const nextRosters: Record<string, PlayerRosterEntry[]> = {}
      const nextErrors: Record<string, string> = {}
      for (const result of results) {
        nextRosters[result.id] = result.roster
        if (result.error) nextErrors[result.id] = result.error
      }
      setRosters(nextRosters)
      setRosterErrors(nextErrors)
      setLoading(false)
    })
  }

  const profileIdsKey = profiles.map((p) => p.id).join(',')
  useEffect(() => {
    loadAll()
    if (profiles.length === 0) return
    const interval = setInterval(loadAll, REFRESH_INTERVAL_MS)
    return () => clearInterval(interval)
    // loadAll is a plain function recreated every render - only re-running this when the set
    // of profiles actually changes (not on every render) is the point here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileIdsKey])

  async function handleKick(profileId: string, player: PlayerRosterEntry): Promise<void> {
    if (!confirmAction(`Kick ${player.name}?`)) return
    setBusyId(player.id)
    setStatusMessage('')
    try {
      await window.api.playerRoster.kick(profileId, player.id)
      setStatusMessage(`Kicked ${player.name}.`)
      loadAll()
    } catch (err) {
      setStatusMessage((err as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleBan(profileId: string, player: PlayerRosterEntry): Promise<void> {
    if (!confirmAction(`Ban ${player.name} on this server?`)) return
    setBusyId(player.id)
    setStatusMessage('')
    try {
      await window.api.playerBans.ban(profileId, player.id, player.name, '')
      setStatusMessage(`Banned ${player.name}.`)
    } catch (err) {
      setStatusMessage((err as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleWhitelist(profileId: string, player: PlayerRosterEntry): Promise<void> {
    setBusyId(player.id)
    setStatusMessage('')
    try {
      await window.api.playerWhitelist.add(profileId, player.id, player.name)
      setStatusMessage(`Added ${player.name} to the whitelist.`)
    } catch (err) {
      setStatusMessage((err as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  if (profiles.length === 0) {
    return (
      <section className="cluster-section">
        <h3>Live players</h3>
        <p className="empty-state">No ARK servers configured yet.</p>
      </section>
    )
  }

  // Ungrouped first (plain grid, no heading), then every named group under its own
  // collapsible heading - same grouping Dashboard.tsx uses for its own server grid, minus
  // drag-reordering (this panel has no persisted layout to reorder).
  const ungrouped = profiles.filter((p) => !p.group.trim())
  const groupNames = Array.from(new Set(profiles.filter((p) => p.group.trim()).map((p) => p.group.trim()))).sort(
    (a, b) => a.localeCompare(b)
  )

  function renderCard(profile: ServerProfile): JSX.Element {
    const roster = rosters[profile.id] ?? []
    const error = rosterErrors[profile.id]
    return (
      <section key={profile.id} className="cluster-section player-roster-card">
        <h3>
          {profile.name} <span className="player-roster-count">({roster.length})</span>
        </h3>
        {error ? (
          <p className="error-message">{error}</p>
        ) : roster.length === 0 ? (
          <p className="empty-state">{loading ? 'Loading...' : 'No players connected right now.'}</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Id</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {roster.map((player) => (
                <tr key={player.id}>
                  <td>{player.name}</td>
                  <td>{player.id}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => void handleKick(profile.id, player)}
                      disabled={busyId === player.id}
                    >
                      Kick
                    </button>{' '}
                    <button
                      type="button"
                      className="btn-delete-backup"
                      onClick={() => void handleBan(profile.id, player)}
                      disabled={busyId === player.id}
                    >
                      Ban
                    </button>{' '}
                    <button
                      type="button"
                      onClick={() => void handleWhitelist(profile.id, player)}
                      disabled={busyId === player.id}
                    >
                      Whitelist
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    )
  }

  return (
    <>
      <div className="form-actions">
        <button type="button" onClick={loadAll} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh all'}
        </button>
        {statusMessage && <span className="empty-state">{statusMessage}</span>}
      </div>
      <div className="player-roster-grid">{ungrouped.map(renderCard)}</div>

      {groupNames.map((groupName) => (
        <details key={groupName} className="server-group" open>
          <summary>{groupName}</summary>
          <div className="player-roster-grid">
            {profiles.filter((p) => p.group.trim() === groupName).map(renderCard)}
          </div>
        </details>
      ))}
    </>
  )
}
