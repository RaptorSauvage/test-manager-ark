import { useEffect, useState } from 'react'
import type { MapDefinition } from '@shared/types'
import { listGameDefinitions } from '@shared/games'
import { confirmAction } from '../lib/confirmAction'

interface MapManagerViewProps {
  onBack: () => void
}

interface MapFormState {
  originalId: string | null
  id: string
  displayName: string
  modId: string
}

const EMPTY_FORM: MapFormState = { originalId: null, id: '', displayName: '', modId: '' }

/** Tools > Map Manager - lets custom/modded maps (customMaps.json) be added/edited/deleted
 *  from the UI instead of hand-editing the JSON file. Official maps (maps.json, one per
 *  game) are shown read-only alongside them for reference, same grouping the map picker in a
 *  server's own Settings tab already uses. */
export default function MapManagerView({ onBack }: MapManagerViewProps): JSX.Element {
  const [officialMaps, setOfficialMaps] = useState<MapDefinition[]>([])
  const [customMaps, setCustomMaps] = useState<MapDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState<MapFormState | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh(): Promise<void> {
    setLoading(true)
    try {
      const [officialLists, custom] = await Promise.all([
        Promise.all(listGameDefinitions().map((g) => window.api.maps.list(g.id))),
        window.api.customMaps.list()
      ])
      setOfficialMaps(officialLists.flat())
      setCustomMaps(custom)
    } finally {
      setLoading(false)
    }
  }

  function openAddForm(): void {
    setError('')
    setForm({ ...EMPTY_FORM })
  }

  function openEditForm(map: MapDefinition): void {
    setError('')
    setForm({ originalId: map.id, id: map.id, displayName: map.displayName, modId: map.modId ?? '' })
  }

  async function saveForm(): Promise<void> {
    if (!form) return
    setSaving(true)
    setError('')
    try {
      const entry = { id: form.id.trim(), displayName: form.displayName.trim(), modId: form.modId.trim() || undefined }
      const updated = form.originalId
        ? await window.api.customMaps.update(form.originalId, entry)
        : await window.api.customMaps.add(entry)
      setCustomMaps(updated)
      setForm(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function deleteMap(map: MapDefinition): Promise<void> {
    if (!confirmAction(`Delete the custom map "${map.displayName}" (${map.id})?`)) return
    const updated = await window.api.customMaps.delete(map.id)
    setCustomMaps(updated)
  }

  return (
    <div className="server-detail">
      <header className="server-detail-header">
        <button onClick={onBack}>&larr; Back</button>
        <h1>Map Database</h1>
      </header>
      <p className="empty-state">
        Manage maps available for server configuration. Custom modded maps will have their mod ID automatically
        added to the server&apos;s mod list when selected.
      </p>

      {loading ? (
        <p className="empty-state">Loading...</p>
      ) : (
        <>
          <section className="cluster-section">
            <div className="map-manager-section-header">
              <h3>
                🌐 Official Maps <span className="map-manager-count">{officialMaps.length}</span>
              </h3>
              <span className="map-manager-lock" title="Official maps ship with the app and can't be edited here">
                🔒
              </span>
            </div>
            <table className="map-manager-table">
              <thead>
                <tr>
                  <th>Map ID</th>
                  <th>Display Name</th>
                </tr>
              </thead>
              <tbody>
                {officialMaps.map((m) => (
                  <tr key={m.id}>
                    <td className="mono">{m.id}</td>
                    <td>{m.displayName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="cluster-section">
            <div className="map-manager-section-header">
              <h3>🧩 Custom Maps</h3>
              <button type="button" className="btn-accent" onClick={openAddForm}>
                + Add Map
              </button>
            </div>
            {customMaps.length === 0 ? (
              <button type="button" className="map-manager-empty" onClick={openAddForm}>
                🗺️
                <span>No custom maps - click to add one</span>
              </button>
            ) : (
              <table className="map-manager-table">
                <thead>
                  <tr>
                    <th>Map ID</th>
                    <th>Display Name</th>
                    <th>Mod ID</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {customMaps.map((m) => (
                    <tr key={m.id}>
                      <td className="mono">{m.id}</td>
                      <td>{m.displayName}</td>
                      <td className="mono">{m.modId ?? <span className="muted">-</span>}</td>
                      <td className="map-manager-row-actions">
                        <button type="button" onClick={() => openEditForm(m)}>
                          Edit
                        </button>
                        <button type="button" className="danger" onClick={() => void deleteMap(m)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      {form && (
        <div className="wizard-overlay" onClick={() => !saving && setForm(null)}>
          <div className="wizard-modal" onClick={(e) => e.stopPropagation()}>
            <div className="wizard-header">
              <span className="wizard-header-icon">🧩</span>
              <h2>{form.originalId ? 'Edit Custom Map' : 'Add Custom Map'}</h2>
              <button type="button" className="wizard-close" onClick={() => setForm(null)} disabled={saving}>
                ✕
              </button>
            </div>
            {error && <p className="error-message">{error}</p>}
            <form
              className="wizard-body"
              onSubmit={(e) => {
                e.preventDefault()
                void saveForm()
              }}
            >
              <label className="wizard-field">
                Map ID
                <input
                  value={form.id}
                  onChange={(e) => setForm({ ...form, id: e.target.value })}
                  placeholder="e.g. CrystalIsles_WP"
                  disabled={saving}
                  autoFocus
                />
              </label>
              <label className="wizard-field">
                Display Name
                <input
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  placeholder="e.g. Crystal Isles"
                  disabled={saving}
                />
              </label>
              <label className="wizard-field">
                Mod ID (optional)
                <input
                  value={form.modId}
                  onChange={(e) => setForm({ ...form, modId: e.target.value })}
                  placeholder="Added to the server's mod list automatically when this map is selected"
                  disabled={saving}
                />
              </label>
              <div className="wizard-footer">
                <div />
                <div>
                  <button type="button" onClick={() => setForm(null)} disabled={saving}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="wizard-primary"
                    disabled={saving || !form.id.trim() || !form.displayName.trim()}
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
