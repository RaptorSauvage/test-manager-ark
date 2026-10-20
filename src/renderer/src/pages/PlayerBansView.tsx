import { useEffect, useState } from 'react'
import type { BannedPlayer, ServerProfile } from '@shared/types'
import { confirmAction } from '../lib/confirmAction'

interface PlayerBansViewProps {
  profiles: ServerProfile[]
  onBack: () => void
}

/** Centralized view of every player banned on any ARK server, merged across servers (one
 *  row per Steam/EOS id, not per server) - see BannedPlayer's own doc comment for why this
 *  exists: ARK itself never shares a ban list between servers, each one keeps its own.
 *  Minecraft isn't covered (different ban command/id shape entirely) - ARK-only for now. */
export default function PlayerBansView({ profiles, onBack }: PlayerBansViewProps): JSX.Element {
  const [bans, setBans] = useState<BannedPlayer[]>([])
  const [playerId, setPlayerId] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [reason, setReason] = useState('')
  const [targetProfileIds, setTargetProfileIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    window.api.playerBans.list().then(setBans)
  }, [])

  function profileName(id: string): string {
    return profiles.find((p) => p.id === id)?.name ?? id
  }

  function toggleTargetProfile(id: string): void {
    setTargetProfileIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  }

  async function handleBan(): Promise<void> {
    setError('')
    if (!playerId.trim() || targetProfileIds.length === 0) {
      setError('Enter a player id and pick at least one server.')
      return
    }
    setBusy(true)
    try {
      let updated = bans
      for (const profileId of targetProfileIds) {
        updated = await window.api.playerBans.ban(profileId, playerId.trim(), playerName.trim() || playerId.trim(), reason.trim())
      }
      setBans(updated)
      setPlayerId('')
      setPlayerName('')
      setReason('')
      setTargetProfileIds([])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleUnban(ban: BannedPlayer, profileId: string): Promise<void> {
    if (!confirmAction(`Unban ${ban.name} on ${profileName(profileId)}?`)) return
    setError('')
    setBusy(true)
    try {
      setBans(await window.api.playerBans.unban(profileId, ban.id))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="server-detail">
      <header className="server-detail-header">
        <button onClick={onBack}>&larr; Back</button>
        <h1>Player Bans</h1>
      </header>

      <section className="cluster-section">
        <h3>Ban a player</h3>
        <p className="empty-state">
          ARK keeps a separate ban list per server - picking more than one server here sends BanPlayer to each of
          them, and they all show up merged into one row below.
        </p>
        <div className="form-actions">
          <input placeholder="Player id (Steam/EOS)" value={playerId} onChange={(e) => setPlayerId(e.target.value)} />
          <input placeholder="Name (optional)" value={playerName} onChange={(e) => setPlayerName(e.target.value)} />
          <input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="server-picker-menu" style={{ position: 'static', maxHeight: 160, overflowY: 'auto' }}>
          {profiles.length === 0 ? (
            <p className="empty-state">No ARK servers configured yet.</p>
          ) : (
            profiles.map((p) => (
              <label key={p.id} className="checkbox server-picker-option">
                <input
                  type="checkbox"
                  checked={targetProfileIds.includes(p.id)}
                  onChange={() => toggleTargetProfile(p.id)}
                />
                {p.name}
              </label>
            ))
          )}
        </div>
        <div className="form-actions">
          <button type="button" onClick={() => void handleBan()} disabled={busy}>
            Ban
          </button>
        </div>
        {error && <p className="error-message">{error}</p>}
      </section>

      <section className="cluster-section">
        <h3>Currently banned ({bans.length})</h3>
        {bans.length === 0 ? (
          <p className="empty-state">No one is banned.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Id</th>
                <th>Reason</th>
                <th>Banned on</th>
                <th>Since</th>
              </tr>
            </thead>
            <tbody>
              {bans.map((ban) => (
                <tr key={ban.id}>
                  <td>{ban.name}</td>
                  <td>{ban.id}</td>
                  <td>{ban.reason || '-'}</td>
                  <td>
                    {ban.profileIds.map((profileId) => (
                      <button
                        key={profileId}
                        type="button"
                        className="btn-delete-backup"
                        title="Unban on this server"
                        onClick={() => void handleUnban(ban, profileId)}
                        disabled={busy}
                        style={{ marginRight: 6, marginBottom: 4 }}
                      >
                        {profileName(profileId)} &times;
                      </button>
                    ))}
                  </td>
                  <td>{new Date(ban.bannedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
