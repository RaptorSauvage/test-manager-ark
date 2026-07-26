import { useState } from 'react'
import type { ServerProfile, ServerMod } from '@shared/types'

interface ModsTabProps {
  profile: ServerProfile
  onProfileChange: (profile: ServerProfile) => void
}

export default function ModsTab({ profile, onProfileChange }: ModsTabProps): JSX.Element {
  const [mods, setMods] = useState<ServerMod[]>(profile.mods)
  const [newModId, setNewModId] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  function addMod(): void {
    const id = newModId.trim()
    if (!id || mods.some((m) => m.id === id)) return
    setMods((prev) => [...prev, { id, enabled: true, dev: false }])
    setNewModId('')
  }

  function removeMod(id: string): void {
    setMods((prev) => prev.filter((m) => m.id !== id))
  }

  function toggleMod(id: string): void {
    setMods((prev) => prev.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m)))
  }

  function toggleDev(id: string): void {
    setMods((prev) => prev.map((m) => (m.id === id ? { ...m, dev: !m.dev } : m)))
  }

  function renameMod(id: string, name: string): void {
    setMods((prev) => prev.map((m) => (m.id === id ? { ...m, name: name || undefined } : m)))
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
    setError('')
    try {
      const updated = await window.api.mods.save(profile.id, mods)
      onProfileChange(updated)
      setStatus('Mods saved. Restart the server to apply changes.')
      setTimeout(() => setStatus(''), 3000)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="mods-tab">
      <p>
        Mod IDs, applied in this order via the server&apos;s <code>-mods=</code> launch flag - the only mechanism
        ARK: Survival Ascended uses for mods. Only <strong>enabled</strong> mods are passed at the next server start;
        disabling one keeps it in the list without loading it. Check <strong>Dev</strong> to load a mod&apos;s
        in-development build (appends <code>-dev</code> to its ID). The name field is just your own label, not
        looked up automatically.
      </p>
      <div className="mods-add">
        <input
          value={newModId}
          onChange={(e) => setNewModId(e.target.value)}
          placeholder="Mod ID"
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
        {mods.map((mod, i) => (
          <li key={mod.id} className={mod.enabled ? '' : 'mod-disabled'}>
            <input type="checkbox" checked={mod.enabled} onChange={() => toggleMod(mod.id)} title="Enabled" />
            <input
              className="mod-name-input"
              value={mod.name ?? ''}
              onChange={(e) => renameMod(mod.id, e.target.value)}
              placeholder="Optional label"
            />
            <span className="mod-id">
              #{mod.id}
              {mod.dev ? '-dev' : ''}
            </span>
            <label className="mod-dev-toggle">
              <input type="checkbox" checked={mod.dev} onChange={() => toggleDev(mod.id)} />
              Dev
            </label>
            <div className="mods-list-actions">
              <button onClick={() => move(i, -1)} disabled={i === 0}>
                ↑
              </button>
              <button onClick={() => move(i, 1)} disabled={i === mods.length - 1}>
                ↓
              </button>
              <button className="danger" onClick={() => removeMod(mod.id)}>
                Remove
              </button>
            </div>
          </li>
        ))}
        {mods.length === 0 && <li className="empty-state">No mods configured.</li>}
      </ol>
      {error && <p className="error-message">{error}</p>}
      <div className="form-actions">
        <button onClick={() => void save()}>Save mods</button>
        {status && <span className="status-message">{status}</span>}
      </div>
    </div>
  )
}
