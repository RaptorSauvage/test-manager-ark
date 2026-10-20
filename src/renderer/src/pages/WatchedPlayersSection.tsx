import { useEffect, useState, type FormEvent } from 'react'
import type { WatchedPlayerAlert } from '@shared/types'
import { confirmAction } from '../lib/confirmAction'

/**
 * The watchlist for the "player joined" Discord alert (see playerJoinAlertWatch.ts in the
 * main process) - a flat list of names/ids to match against, independent of the channel id
 * and enabled toggle above it (those two live on AppSettings/the Save button, this list has
 * its own add/remove IPC since it's not something you'd want to lose by forgetting to hit
 * Save on an unrelated field).
 */
export default function WatchedPlayersSection(): JSX.Element {
  const [players, setPlayers] = useState<WatchedPlayerAlert[]>([])
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    window.api.watchedPlayers.list().then(setPlayers)
  }, [])

  async function handleAdd(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    if (!value.trim()) {
      setError('Enter a player name or id.')
      return
    }
    try {
      setPlayers(await window.api.watchedPlayers.add(value.trim(), label.trim()))
      setValue('')
      setLabel('')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function handleRemove(entry: WatchedPlayerAlert): Promise<void> {
    if (!confirmAction(`Stop watching "${entry.label || entry.value}"?`)) return
    setPlayers(await window.api.watchedPlayers.remove(entry.id))
  }

  return (
    <section className="accounts-section">
      <h3>Watched players</h3>
      <p className="empty-state">
        Matched case-insensitively against either the joining player&apos;s in-game name or their Steam/EOS id, on
        every ARK server at once.
      </p>
      <form className="accounts-add-form" onSubmit={(e) => void handleAdd(e)}>
        <input placeholder="Name or Steam/EOS id" value={value} onChange={(e) => setValue(e.target.value)} />
        <input placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button type="submit">Add</button>
      </form>
      {error && <p className="error-message">{error}</p>}

      {players.length === 0 ? (
        <p className="empty-state">No watched players yet.</p>
      ) : (
        <table className="accounts-table">
          <thead>
            <tr>
              <th>Name/Id</th>
              <th>Label</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id}>
                <td>{p.value}</td>
                <td>{p.label || '-'}</td>
                <td className="accounts-row-actions">
                  <button type="button" className="btn-delete-backup" onClick={() => void handleRemove(p)}>
                    Remove
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
