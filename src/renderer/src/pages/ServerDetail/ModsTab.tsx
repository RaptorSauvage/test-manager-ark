import { useState } from 'react'
import type { ServerProfile } from '@shared/types'

interface ModsTabProps {
  profile: ServerProfile
  onProfileChange: (profile: ServerProfile) => void
}

export default function ModsTab({ profile, onProfileChange }: ModsTabProps): JSX.Element {
  const [mods, setMods] = useState<string[]>(profile.activeMods)
  const [newModId, setNewModId] = useState('')
  const [status, setStatus] = useState('')

  function addMod(): void {
    const id = newModId.trim()
    if (!id || mods.includes(id)) return
    setMods((prev) => [...prev, id])
    setNewModId('')
  }

  function removeMod(id: string): void {
    setMods((prev) => prev.filter((m) => m !== id))
  }

  function move(index: number, direction: -1 | 1): void {
    setMods((prev) => {
      const next = [...prev]
      const target = index + direction
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  async function save(): Promise<void> {
    const updated = await window.api.config.saveMods(profile.id, mods)
    onProfileChange(updated)
    setStatus('Mods saved. Restart the server to apply changes.')
    setTimeout(() => setStatus(''), 3000)
  }

  return (
    <div className="mods-tab">
      <p>Steam Workshop mod IDs, applied in this load order at the next server start.</p>
      <div className="mods-add">
        <input
          value={newModId}
          onChange={(e) => setNewModId(e.target.value)}
          placeholder="Workshop mod ID"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addMod()
            }
          }}
        />
        <button onClick={addMod}>Add</button>
      </div>
      <ol className="mods-list">
        {mods.map((id, i) => (
          <li key={id}>
            <span>{id}</span>
            <div className="mods-list-actions">
              <button onClick={() => move(i, -1)} disabled={i === 0}>
                ↑
              </button>
              <button onClick={() => move(i, 1)} disabled={i === mods.length - 1}>
                ↓
              </button>
              <button className="danger" onClick={() => removeMod(id)}>
                Remove
              </button>
            </div>
          </li>
        ))}
        {mods.length === 0 && <li className="empty-state">No mods configured.</li>}
      </ol>
      <div className="form-actions">
        <button onClick={() => void save()}>Save mods</button>
        {status && <span className="status-message">{status}</span>}
      </div>
    </div>
  )
}
