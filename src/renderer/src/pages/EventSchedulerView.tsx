import { useEffect, useState } from 'react'
import type { ModEvent, ModEventHistoryEntry, ServerProfile } from '@shared/types'
import { isEventActive } from '@shared/modEventSchedule'
import { confirmAction } from '../lib/confirmAction'

interface EventSchedulerViewProps {
  profiles: ServerProfile[]
  onBack: () => void
}

interface EventFormState {
  id: string | null
  name: string
  modIdsText: string
  recurringYearly: boolean
  startAt: string
  endAt: string
  targetMode: 'all' | 'specific'
  specificIds: string[]
  shutdownOnStart: boolean
  shutdownOnEnd: boolean
  enabled: boolean
}

const EMPTY_FORM: EventFormState = {
  id: null,
  name: '',
  modIdsText: '',
  recurringYearly: false,
  startAt: '',
  endAt: '',
  targetMode: 'all',
  specificIds: [],
  shutdownOnStart: false,
  shutdownOnEnd: false,
  enabled: true
}

/** ISO datetime -> the "YYYY-MM-DDTHH:mm" value an <input type="datetime-local"> needs -
 *  built from the Date's own local getters (not a slice of toISOString, which is UTC and
 *  would silently shift the displayed time across a timezone offset). */
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatShort(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

type EventStatus = 'active' | 'scheduled' | 'disabled'

function statusOf(event: ModEvent): EventStatus {
  if (!event.enabled) return 'disabled'
  return isEventActive(event, new Date()) ? 'active' : 'scheduled'
}

/** Tools > Event Scheduler - automatically adds a set of mod ids to target servers' mod
 *  lists when an event starts, and removes them again when it ends (see ModEvent's own doc
 *  comment, shared/types.ts, and the scheduling engine in src/main/lib/modEvents.ts). */
export default function EventSchedulerView({ profiles, onBack }: EventSchedulerViewProps): JSX.Element {
  const [tab, setTab] = useState<'events' | 'history'>('events')
  const [events, setEvents] = useState<ModEvent[]>([])
  const [history, setHistory] = useState<ModEventHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<EventFormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh(): Promise<void> {
    setLoading(true)
    try {
      const [list, hist] = await Promise.all([window.api.modEvents.list(), window.api.modEvents.history()])
      setEvents(list)
      setHistory(hist)
    } finally {
      setLoading(false)
    }
  }

  function openNewForm(): void {
    setError('')
    setForm({ ...EMPTY_FORM })
  }

  function openEditForm(event: ModEvent): void {
    setError('')
    setForm({
      id: event.id,
      name: event.name,
      modIdsText: event.modIds.join(', '),
      recurringYearly: event.recurringYearly,
      startAt: toDatetimeLocalValue(event.startAt),
      endAt: toDatetimeLocalValue(event.endAt),
      targetMode: event.targetServers === 'all' ? 'all' : 'specific',
      specificIds: event.targetServers === 'all' ? [] : event.targetServers,
      shutdownOnStart: event.shutdownOnStart,
      shutdownOnEnd: event.shutdownOnEnd,
      enabled: event.enabled
    })
  }

  function toggleSpecificId(id: string): void {
    if (!form) return
    setForm({
      ...form,
      specificIds: form.specificIds.includes(id) ? form.specificIds.filter((x) => x !== id) : [...form.specificIds, id]
    })
  }

  async function saveForm(): Promise<void> {
    if (!form) return
    const name = form.name.trim()
    const modIds = Array.from(new Set(form.modIdsText.split(',').map((s) => s.trim()).filter(Boolean)))
    if (!name) {
      setError('Event name is required')
      return
    }
    if (modIds.length === 0) {
      setError('At least one Mod ID is required')
      return
    }
    if (!form.startAt || !form.endAt) {
      setError('Start and End date/time are required')
      return
    }
    if (form.targetMode === 'specific' && form.specificIds.length === 0) {
      setError('Select at least one server, or switch to All Servers')
      return
    }

    setSaving(true)
    setError('')
    try {
      const event: ModEvent = {
        id: form.id ?? `mod-event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        modIds,
        recurringYearly: form.recurringYearly,
        startAt: new Date(form.startAt).toISOString(),
        endAt: new Date(form.endAt).toISOString(),
        targetServers: form.targetMode === 'all' ? 'all' : form.specificIds,
        shutdownOnStart: form.shutdownOnStart,
        shutdownOnEnd: form.shutdownOnEnd,
        enabled: form.enabled
      }
      const updated = await window.api.modEvents.save(event)
      setEvents(updated)
      setForm(null)
      setHistory(await window.api.modEvents.history())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled(event: ModEvent): Promise<void> {
    const updated = await window.api.modEvents.save({ ...event, enabled: !event.enabled })
    setEvents(updated)
  }

  async function deleteEvent(): Promise<void> {
    if (!form?.id) return
    if (!confirmAction(`Delete the event "${form.name}"? This does not undo any mods it already added/removed.`)) return
    setSaving(true)
    try {
      setEvents(await window.api.modEvents.delete(form.id))
      setForm(null)
    } finally {
      setSaving(false)
    }
  }

  function profileName(id: string): string {
    return profiles.find((p) => p.id === id)?.name ?? id
  }

  function serversLabel(event: ModEvent): string {
    if (event.targetServers === 'all') return 'All'
    if (event.targetServers.length === 0) return '-'
    if (event.targetServers.length <= 2) return event.targetServers.map(profileName).join(', ')
    return `${event.targetServers.length} servers`
  }

  function shutdownLabel(event: ModEvent): string {
    if (event.shutdownOnStart && event.shutdownOnEnd) return 'Start & End'
    if (event.shutdownOnStart) return 'On Start'
    if (event.shutdownOnEnd) return 'On End'
    return '-'
  }

  const statusBadgeClass: Record<EventStatus, string> = {
    active: 'badge-running',
    scheduled: 'badge-scheduled',
    disabled: 'badge-disabled'
  }
  const statusLabel: Record<EventStatus, string> = { active: 'Active', scheduled: 'Scheduled', disabled: 'Disabled' }

  return (
    <div className="server-detail event-scheduler-view">
      <header className="server-detail-header">
        <button onClick={onBack}>&larr; Back</button>
        <h1>Event Scheduler</h1>
        <button type="button" className="btn-accent event-scheduler-new-btn" onClick={openNewForm}>
          + New Event
        </button>
      </header>
      <p className="empty-state">Schedule game events to automatically add or remove mods on your servers.</p>

      <nav className="tab-nav">
        <button className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}>
          Events
        </button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
          History
        </button>
      </nav>

      {loading ? (
        <p className="empty-state">Loading...</p>
      ) : tab === 'events' ? (
        events.length === 0 ? (
          <p className="empty-state">No events yet - click &quot;+ New Event&quot; to create one.</p>
        ) : (
          <table className="map-manager-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Mod IDs</th>
                <th>Start</th>
                <th>End</th>
                <th>Servers</th>
                <th>Shutdown</th>
                <th>Status</th>
                <th>Enabled</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const status = statusOf(event)
                return (
                  <tr key={event.id}>
                    <td>
                      <strong>{event.name}</strong>
                      {event.recurringYearly && <span className="event-badge">↻ Yearly</span>}
                    </td>
                    <td className="mono">{event.modIds.join(', ')}</td>
                    <td>{formatShort(event.startAt)}</td>
                    <td>{formatShort(event.endAt)}</td>
                    <td>{serversLabel(event)}</td>
                    <td>{shutdownLabel(event)}</td>
                    <td>
                      <span className={`badge ${statusBadgeClass[status]}`}>{statusLabel[status]}</span>
                    </td>
                    <td>
                      <label className="checkbox">
                        <input type="checkbox" checked={event.enabled} onChange={() => void toggleEnabled(event)} />
                      </label>
                    </td>
                    <td>
                      <button type="button" onClick={() => openEditForm(event)} title="Edit">
                        ✎
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )
      ) : history.length === 0 ? (
        <p className="empty-state">No activity yet.</p>
      ) : (
        <table className="map-manager-table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Action</th>
              <th>When</th>
              <th>Servers</th>
            </tr>
          </thead>
          <tbody>
            {history.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.eventName}</td>
                <td>
                  <span className={`badge ${entry.action === 'activated' ? 'badge-running' : 'badge-stopped'}`}>
                    {entry.action === 'activated' ? 'Mods Added' : 'Mods Removed'}
                  </span>
                </td>
                <td>{new Date(entry.timestamp).toLocaleString()}</td>
                <td>
                  {entry.profileIds.map(profileName).join(', ') || '-'}
                  {entry.errors && Object.keys(entry.errors).length > 0 && (
                    <span className="error-message"> - {Object.keys(entry.errors).length} failed</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {form && (
        <div className="wizard-overlay" onClick={() => !saving && setForm(null)}>
          <div className="wizard-modal wizard-modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="wizard-header">
              <span className="wizard-header-icon">📅</span>
              <h2>{form.id ? 'Edit Event' : 'New Event'}</h2>
              <button type="button" className="wizard-close" onClick={() => setForm(null)} disabled={saving}>
                ✕
              </button>
            </div>
            <p className="wizard-subtitle">Schedule a game event to automatically add and remove mods</p>

            {error && <p className="error-message">{error}</p>}

            <form
              className="wizard-body"
              onSubmit={(e) => {
                e.preventDefault()
                void saveForm()
              }}
            >
              <h3 className="event-scheduler-form-section">Event Details</h3>
              <label className="wizard-field">
                Event Name
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g., Fear Ascended (Halloween)"
                  disabled={saving}
                  autoFocus
                />
              </label>
              <label className="wizard-field">
                Mod IDs
                <input
                  value={form.modIdsText}
                  onChange={(e) => setForm({ ...form, modIdsText: e.target.value })}
                  placeholder="e.g., 877752, 927084"
                  disabled={saving}
                />
                <span className="empty-state">Comma-separated CurseForge mod IDs</span>
              </label>

              <h3 className="event-scheduler-form-section">Schedule</h3>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={form.recurringYearly}
                  onChange={(e) => setForm({ ...form, recurringYearly: e.target.checked })}
                  disabled={saving}
                />
                Recurring yearly
              </label>
              <div className="settings-grid">
                <label className="wizard-field">
                  Start Date &amp; Time
                  <input
                    type="datetime-local"
                    value={form.startAt}
                    onChange={(e) => setForm({ ...form, startAt: e.target.value })}
                    disabled={saving}
                  />
                </label>
                <label className="wizard-field">
                  End Date &amp; Time
                  <input
                    type="datetime-local"
                    value={form.endAt}
                    onChange={(e) => setForm({ ...form, endAt: e.target.value })}
                    disabled={saving}
                  />
                </label>
              </div>

              <h3 className="event-scheduler-form-section">Target Servers</h3>
              <div className="event-target-toggle">
                <button
                  type="button"
                  className={form.targetMode === 'all' ? 'active' : ''}
                  onClick={() => setForm({ ...form, targetMode: 'all' })}
                  disabled={saving}
                >
                  All Servers
                </button>
                <button
                  type="button"
                  className={form.targetMode === 'specific' ? 'active' : ''}
                  onClick={() => setForm({ ...form, targetMode: 'specific' })}
                  disabled={saving}
                >
                  Specific Servers
                </button>
              </div>
              {form.targetMode === 'specific' && (
                <div className="event-scheduler-server-list">
                  {profiles.length === 0 && <p className="empty-state">No ARK servers yet.</p>}
                  {profiles.map((p) => (
                    <label className="checkbox" key={p.id}>
                      <input
                        type="checkbox"
                        checked={form.specificIds.includes(p.id)}
                        onChange={() => toggleSpecificId(p.id)}
                        disabled={saving}
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              )}

              <h3 className="event-scheduler-form-section">Shutdown Behaviour</h3>
              <p className="empty-state">
                Optionally trigger a graceful server shutdown (then restart) when the event starts/ends, so the mod
                change takes effect immediately instead of on the next manual restart.
              </p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={form.shutdownOnStart}
                  onChange={(e) => setForm({ ...form, shutdownOnStart: e.target.checked })}
                  disabled={saving}
                />
                Shutdown when event starts
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={form.shutdownOnEnd}
                  onChange={(e) => setForm({ ...form, shutdownOnEnd: e.target.checked })}
                  disabled={saving}
                />
                Shutdown when event ends
              </label>

              <div className="wizard-footer">
                <div>
                  {form.id && (
                    <button type="button" className="danger" onClick={() => void deleteEvent()} disabled={saving}>
                      Delete Event
                    </button>
                  )}
                </div>
                <div>
                  <button type="button" onClick={() => setForm(null)} disabled={saving}>
                    Cancel
                  </button>
                  <button type="submit" className="wizard-primary" disabled={saving}>
                    {saving ? 'Saving...' : form.id ? 'Save Event' : 'Create Event'}
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
