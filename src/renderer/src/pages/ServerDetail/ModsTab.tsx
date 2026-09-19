import { useState } from 'react'
import type { ServerProfile, ServerMod } from '@shared/types'

interface ModsTabProps {
  profile: ServerProfile
  onProfileChange: (profile: ServerProfile) => void
}

export default function ModsTab({ profile, onProfileChange }: ModsTabProps): JSX.Element {
  const [mods, setMods] = useState<ServerMod[]>(profile.mods)
  const [status, setStatus] = useState('')
  const [newModId, setNewModId] = useState('')
  const [error, setError] = useState('')
  const [pasteText, setPasteText] = useState('')

  async function persist(next: ServerMod[]): Promise<void> {
    setError('')
    try {
      const updated = await window.api.mods.save(profile.id, next)
      onProfileChange(updated)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function applyMods(next: ServerMod[]): void {
    setMods(next)
    void persist(next)
  }

  function addMod(): void {
    const id = newModId.trim()
    if (!id || mods.some((m) => m.id === id)) return
    applyMods([...mods, { id, enabled: true, passive: false, dev: false }])
    setNewModId('')
  }

  function removeMod(id: string): void {
    applyMods(mods.filter((m) => m.id !== id))
  }

  function toggleField(id: string, field: 'enabled' | 'passive' | 'dev'): void {
    applyMods(mods.map((m) => (m.id === id ? { ...m, [field]: !m[field] } : m)))
  }

  function toggleAll(field: 'enabled' | 'passive' | 'dev'): void {
    const allSet = mods.length > 0 && mods.every((m) => m[field])
    applyMods(mods.map((m) => ({ ...m, [field]: !allSet })))
  }

  function renameMod(id: string, name: string): void {
    applyMods(mods.map((m) => (m.id === id ? { ...m, name: name || undefined } : m)))
  }

  function move(index: number, direction: -1 | 1): void {
    const next = [...mods]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    applyMods(next)
  }

  function moveToTop(index: number): void {
    if (index <= 0) return
    const next = [...mods]
    const [moved] = next.splice(index, 1)
    next.unshift(moved)
    applyMods(next)
  }

  async function copyMods(): Promise<void> {
    setError('')
    try {
      await navigator.clipboard.writeText(JSON.stringify(mods, null, 2))
      setStatus('Mod list copied to clipboard.')
      setTimeout(() => setStatus(''), 2000)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function importPastedMods(): Promise<void> {
    setError('')
    try {
      const imported = await window.api.mods.parseText(pasteText)
      applyMods(imported)
      setPasteText('')
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
        label, typed in by hand - not looked up automatically. Changes save immediately - restart the server
        to actually apply them.
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
      {status && (
        <div className="form-actions">
          <span className="status-message">{status}</span>
        </div>
      )}

      <section className="mods-copy-paste">
        <h3>Copy / Paste Mod List</h3>
        <p className="empty-state">
          Copy this server&apos;s current mod list as text to share it or keep as a backup, or paste a previously
          copied list below to replace the mod list above with it.
        </p>
        <div className="form-actions">
          <button type="button" onClick={() => void copyMods()}>
            Copy mod list to clipboard
          </button>
        </div>
        <textarea
          className="mods-paste-area"
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder="Paste a copied mod list here..."
          spellCheck={false}
        />
        <div className="form-actions">
          <button type="button" onClick={() => void importPastedMods()} disabled={!pasteText.trim()}>
            Import pasted list
          </button>
        </div>
      </section>
    </div>
  )
}
