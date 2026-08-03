import { useEffect, useRef, useState } from 'react'
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
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout>>()
  const mounted = useRef(false)

  function addMod(): void {
    const id = newModId.trim()
    if (!id || mods.some((m) => m.id === id)) return
    setMods((prev) => [...prev, { id, enabled: true, passive: false, dev: false }])
    setNewModId('')
  }

  function removeMod(id: string): void {
    setMods((prev) => prev.filter((m) => m.id !== id))
  }

  function toggleField(id: string, field: 'enabled' | 'passive' | 'dev'): void {
    setMods((prev) => prev.map((m) => (m.id === id ? { ...m, [field]: !m[field] } : m)))
  }

  function toggleAll(field: 'enabled' | 'passive' | 'dev'): void {
    const allSet = mods.length > 0 && mods.every((m) => m[field])
    setMods((prev) => prev.map((m) => ({ ...m, [field]: !allSet })))
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

  function moveToTop(index: number): void {
    setMods((prev) => {
      if (index <= 0) return prev
      const next = [...prev]
      const [moved] = next.splice(index, 1)
      next.unshift(moved)
      return next
    })
  }

  async function save(): Promise<void> {
    clearTimeout(autoSaveTimer.current)
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

  // Auto-saves shortly after the last edit, so switching tabs or closing the app never
  // loses a change - no need to remember to click Save. Debounced rather than saving on
  // every keystroke (e.g. typing a mod's display name).
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => void save(), 800)
    return () => clearTimeout(autoSaveTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mods])

  async function exportMods(): Promise<void> {
    setError('')
    try {
      const filePath = await window.api.dialog.saveModsFile(`${profile.name}-mods`)
      if (!filePath) return
      await window.api.mods.exportToFile(filePath, mods)
      setStatus('Exported')
      setTimeout(() => setStatus(''), 2000)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function importMods(): Promise<void> {
    setError('')
    try {
      const filePath = await window.api.dialog.selectModsFile()
      if (!filePath) return
      const imported = await window.api.mods.importFromFile(filePath)
      setMods(imported)
      setStatus('Mod list imported.')
      setTimeout(() => setStatus(''), 3000)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="mods-tab">
      <p>
        Mod IDs, applied in this order. <strong>Enabled</strong> mods are passed via the server&apos;s{' '}
        <code>-mods=</code> launch flag at the next start, unless <strong>Passive</strong> is checked, in
        which case they go via <code>-passivemods=</code> instead. Check <strong>Dev</strong> to load a
        mod&apos;s in-development build (appends <code>-dev</code> to its ID). Mod Name is just your own
        label, typed in by hand - not looked up automatically.
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
      <table className="mods-table">
        <thead>
          <tr>
            <th className="mods-select-col">
              <div className="mods-select-col-header">
                <input
                  type="checkbox"
                  checked={mods.length > 0 && mods.every((m) => m.enabled)}
                  onChange={() => toggleAll('enabled')}
                  disabled={mods.length === 0}
                  title="Enable all"
                />
                <span>Enable</span>
              </div>
            </th>
            <th className="mods-select-col">
              <div className="mods-select-col-header">
                <input
                  type="checkbox"
                  checked={mods.length > 0 && mods.every((m) => m.passive)}
                  onChange={() => toggleAll('passive')}
                  disabled={mods.length === 0}
                  title="Mark all as passive"
                />
                <span>Passive</span>
              </div>
            </th>
            <th className="mods-select-col">
              <div className="mods-select-col-header">
                <input
                  type="checkbox"
                  checked={mods.length > 0 && mods.every((m) => m.dev)}
                  onChange={() => toggleAll('dev')}
                  disabled={mods.length === 0}
                  title="Mark all as dev"
                />
                <span>Dev</span>
              </div>
            </th>
            <th>Mod Name</th>
            <th>Mod ID</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {mods.map((mod, i) => (
            <tr key={mod.id} className={mod.enabled ? '' : 'mod-disabled'}>
              <td className="mods-select-col">
                <input type="checkbox" checked={mod.enabled} onChange={() => toggleField(mod.id, 'enabled')} />
              </td>
              <td className="mods-select-col">
                <input type="checkbox" checked={mod.passive} onChange={() => toggleField(mod.id, 'passive')} />
              </td>
              <td className="mods-select-col">
                <input type="checkbox" checked={mod.dev} onChange={() => toggleField(mod.id, 'dev')} />
              </td>
              <td>
                <input
                  className="mod-name-input"
                  value={mod.name ?? ''}
                  onChange={(e) => renameMod(mod.id, e.target.value)}
                  placeholder="Optional label"
                />
              </td>
              <td className="mod-id">
                {mod.id}
                {mod.dev ? '-dev' : ''}
              </td>
              <td className="mods-list-actions">
                <button onClick={() => moveToTop(i)} disabled={i === 0} title="Move to top of list">
                  ⤒
                </button>
                <button onClick={() => move(i, -1)} disabled={i === 0}>
                  ↑
                </button>
                <button onClick={() => move(i, 1)} disabled={i === mods.length - 1}>
                  ↓
                </button>
                <button className="danger" onClick={() => removeMod(mod.id)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
          {mods.length === 0 && (
            <tr>
              <td colSpan={6} className="empty-state">
                No mods configured.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {error && <p className="error-message">{error}</p>}
      <p className="empty-state">Changes save automatically a moment after you make them - no need to click Save.</p>
      <div className="form-actions">
        <button onClick={() => void save()}>Save now</button>
        <button type="button" onClick={() => void exportMods()}>
          Export mod list...
        </button>
        <button type="button" onClick={() => void importMods()}>
          Import mod list...
        </button>
        {status && <span className="status-message">{status}</span>}
      </div>
    </div>
  )
}
