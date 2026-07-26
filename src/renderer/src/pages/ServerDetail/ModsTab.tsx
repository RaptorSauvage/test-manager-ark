import { useEffect, useState } from 'react'
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
  const [loadingNames, setLoadingNames] = useState(false)
  const missingNamesKey = mods
    .filter((m) => !m.name)
    .map((m) => m.id)
    .join(',')

  useEffect(() => {
    const missing = missingNamesKey ? missingNamesKey.split(',') : []
    if (missing.length === 0) return

    let cancelled = false
    setLoadingNames(true)
    window.api.mods
      .lookupNames(missing)
      .then((names) => {
        if (cancelled) return
        setMods((prev) => prev.map((m) => (names[m.id] ? { ...m, name: names[m.id] } : m)))
      })
      .finally(() => {
        if (!cancelled) setLoadingNames(false)
      })

    return () => {
      cancelled = true
    }
  }, [missingNamesKey])

  function addMod(): void {
    const id = newModId.trim()
    if (!id || mods.some((m) => m.id === id)) return
    setMods((prev) => [...prev, { id, enabled: true }])
    setNewModId('')
  }

  function removeMod(id: string): void {
    setMods((prev) => prev.filter((m) => m.id !== id))
  }

  function toggleMod(id: string): void {
    setMods((prev) => prev.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m)))
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
        Steam Workshop mods, applied in this order at the next server start. Only <strong>enabled</strong> mods are
        passed to the server — disable one to keep it in the list without loading it.
      </p>
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
        {mods.map((mod, i) => (
          <li key={mod.id} className={mod.enabled ? '' : 'mod-disabled'}>
            <label className="mod-toggle">
              <input type="checkbox" checked={mod.enabled} onChange={() => toggleMod(mod.id)} />
              <span className="mod-name">{mod.name ?? mod.id}</span>
              {mod.name && <span className="mod-id">#{mod.id}</span>}
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
        {loadingNames && <span className="status-message">Looking up mod names...</span>}
        {status && <span className="status-message">{status}</span>}
      </div>
    </div>
  )
}
