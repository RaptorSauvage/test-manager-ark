import { useEffect, useState } from 'react'
import type { ServerProfile, PlayerRosterEntry } from '@shared/types'
import { confirmAction } from '../lib/confirmAction'

interface PlayerRosterPanelProps {
  profiles: ServerProfile[]
}

const REFRESH_INTERVAL_MS = 15_000

/** One server's live connected-player list, straight from RCON ListPlayers - unlike
 *  PlayerBansPanel/PlayerActivityPanel (the Manager's own merged, persisted records across
 *  every server), this is per-server and only ever reflects who's online right now, refreshed
 *  on a short timer while this panel's open. Kick/Ban/Add-to-whitelist act directly on a row -
 *  the same actions the web dashboard's own player context menu already offers, just inline
 *  buttons instead of a right-click menu. */
export default function PlayerRosterPanel({ profiles }: PlayerRosterPanelProps): JSX.Element {
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? '')
  const [roster, setRoster] = useState<PlayerRosterEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')

  useEffect(() => {
    if (!profileId && profiles.length > 0) setProfileId(profiles[0].id)
  }, [profiles, profileId])

  function loadRoster(id: string): void {
    if (!id) {
      setRoster([])
      return
    }
    setLoading(true)
    setError('')
    window.api.playerRoster
      .list(id)
      .then(setRoster)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadRoster(profileId)
    if (!profileId) return
    const interval = setInterval(() => loadRoster(profileId), REFRESH_INTERVAL_MS)
    return () => clearInterval(interval)
    // loadRoster is a plain function recreated every render - only re-running this on the
    // profileId itself changing (not on every render) is the point here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  async function handleKick(player: PlayerRosterEntry): Promise<void> {
    if (!confirmAction(`Kick ${player.name}?`)) return
    setBusyId(player.id)
    setStatusMessage('')
    setError('')
    try {
      await window.api.playerRoster.kick(profileId, player.id)
      setStatusMessage(`Kicked ${player.name}.`)
      loadRoster(profileId)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleBan(player: PlayerRosterEntry): Promise<void> {
    if (!confirmAction(`Ban ${player.name} on this server?`)) return
    setBusyId(player.id)
    setStatusMessage('')
    setError('')
    try {
      await window.api.playerBans.ban(profileId, player.id, player.name, '')
      setStatusMessage(`Banned ${player.name}.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleWhitelist(player: PlayerRosterEntry): Promise<void> {
    setBusyId(player.id)
    setStatusMessage('')
    setError('')
    try {
      await window.api.playerWhitelist.add(profileId, player.id, player.name)
      setStatusMessage(`Added ${player.name} to the whitelist.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="cluster-section">
      <h3>Live players</h3>
      {profiles.length === 0 ? (
        <p className="empty-state">No ARK servers configured yet.</p>
      ) : (
        <>
          <div className="form-actions">
            <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => loadRoster(profileId)} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          {error && <p className="error-message">{error}</p>}
          {statusMessage && <p className="empty-state">{statusMessage}</p>}
          {roster.length === 0 ? (
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
                      <button type="button" onClick={() => void handleKick(player)} disabled={busyId === player.id}>
                        Kick
                      </button>{' '}
                      <button
                        type="button"
                        className="btn-delete-backup"
                        onClick={() => void handleBan(player)}
                        disabled={busyId === player.id}
                      >
                        Ban
                      </button>{' '}
                      <button type="button" onClick={() => void handleWhitelist(player)} disabled={busyId === player.id}>
                        Whitelist
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  )
}
