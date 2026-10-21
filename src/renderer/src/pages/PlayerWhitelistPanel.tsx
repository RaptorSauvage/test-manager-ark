import { useEffect, useState } from 'react'
import type { WhitelistedPlayer, ServerProfile } from '@shared/types'
import { confirmAction } from '../lib/confirmAction'

interface PlayerWhitelistPanelProps {
  profiles: ServerProfile[]
}

const UNGROUPED_LABEL = 'Ungrouped'

/** Centralized, tracking-only whitelist (ARK only) - parallel to PlayerBansPanel, but add/
 *  remove here never touch RCON (see WhitelistedPlayer's own doc comment for why). Also
 *  reachable one row at a time from PlayerRosterPanel's "Whitelist" button on a currently
 *  connected player - this panel is where those entries (and manually-added ones) are
 *  reviewed or removed. */
export default function PlayerWhitelistPanel({ profiles }: PlayerWhitelistPanelProps): JSX.Element {
  const [entries, setEntries] = useState<WhitelistedPlayer[]>([])
  const [playerId, setPlayerId] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [targetProfileIds, setTargetProfileIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    window.api.playerWhitelist.list().then(setEntries)
  }, [])

  function profileName(id: string): string {
    return profiles.find((p) => p.id === id)?.name ?? id
  }

  function toggleTargetProfile(id: string): void {
    setTargetProfileIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  }

  const allSelected = profiles.length > 0 && targetProfileIds.length === profiles.length
  function toggleAll(): void {
    setTargetProfileIds(allSelected ? [] : profiles.map((p) => p.id))
  }

  // Same ungrouped-then-alphabetical column ordering as PlayerBansPanel's own server picker.
  const ungrouped = profiles.filter((p) => !p.group.trim())
  const groupNames = Array.from(new Set(profiles.filter((p) => p.group.trim()).map((p) => p.group.trim()))).sort((a, b) =>
    a.localeCompare(b)
  )
  const columns: Array<{ label: string; profiles: ServerProfile[] }> = [
    ...(ungrouped.length > 0 ? [{ label: UNGROUPED_LABEL, profiles: ungrouped }] : []),
    ...groupNames.map((name) => ({ label: name, profiles: profiles.filter((p) => p.group.trim() === name) }))
  ]

  async function handleAdd(): Promise<void> {
    setError('')
    if (!playerId.trim() || targetProfileIds.length === 0) {
      setError('Enter a player id and pick at least one server.')
      return
    }
    setBusy(true)
    try {
      let updated = entries
      for (const profileId of targetProfileIds) {
        updated = await window.api.playerWhitelist.add(profileId, playerId.trim(), playerName.trim() || playerId.trim())
      }
      setEntries(updated)
      setPlayerId('')
      setPlayerName('')
      setTargetProfileIds([])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(entry: WhitelistedPlayer, profileId: string): Promise<void> {
    if (!confirmAction(`Remove ${entry.name} from the whitelist on ${profileName(profileId)}?`)) return
    setError('')
    setBusy(true)
    try {
      setEntries(await window.api.playerWhitelist.remove(profileId, entry.id))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="cluster-section">
        <h3>Whitelist a player</h3>
        <p className="empty-state">
          Tracking only - this doesn't restrict who can actually join, it's just a shared note of known/trusted
          players. Picking more than one server adds the same entry to each, merged into one row below.
        </p>
        <div className="form-actions">
          <input placeholder="Player id (Steam/EOS)" value={playerId} onChange={(e) => setPlayerId(e.target.value)} />
          <input placeholder="Name (optional)" value={playerName} onChange={(e) => setPlayerName(e.target.value)} />
        </div>
        {profiles.length === 0 ? (
          <p className="empty-state">No ARK servers configured yet.</p>
        ) : (
          <>
            <div className="form-actions">
              <button type="button" onClick={toggleAll}>
                {allSelected ? 'Deselect all' : 'All'}
              </button>
              <span className="empty-state">{targetProfileIds.length} of {profiles.length} selected</span>
            </div>
            <div className="ban-picker-columns">
              {columns.map((column) => (
                <div key={column.label} className="ban-picker-column">
                  <h4>{column.label}</h4>
                  {column.profiles.map((p) => (
                    <label key={p.id} className="checkbox ban-picker-option">
                      <input
                        type="checkbox"
                        checked={targetProfileIds.includes(p.id)}
                        onChange={() => toggleTargetProfile(p.id)}
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
        <div className="form-actions">
          <button type="button" onClick={() => void handleAdd()} disabled={busy}>
            Add
          </button>
        </div>
        {error && <p className="error-message">{error}</p>}
      </section>

      <section className="cluster-section">
        <h3>Whitelisted ({entries.length})</h3>
        {entries.length === 0 ? (
          <p className="empty-state">No one is whitelisted.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Id</th>
                <th>On</th>
                <th>Since</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.name}</td>
                  <td>{entry.id}</td>
                  <td>
                    {entry.profileIds.map((profileId) => (
                      <button
                        key={profileId}
                        type="button"
                        className="btn-delete-backup"
                        title="Remove from the whitelist on this server"
                        onClick={() => void handleRemove(entry, profileId)}
                        disabled={busy}
                        style={{ marginRight: 6, marginBottom: 4 }}
                      >
                        {profileName(profileId)} &times;
                      </button>
                    ))}
                  </td>
                  <td>{new Date(entry.addedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}
