import { useEffect, useState } from 'react'
import type { OfficialServerStatusData } from '@shared/types'

export default function OfficialServerStatusPanel(): JSX.Element {
  const [data, setData] = useState<OfficialServerStatusData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function refresh(): Promise<void> {
    setLoading(true)
    setError('')
    try {
      setData(await window.api.officialServerStatus.get())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  function badge(value: string): JSX.Element {
    const normalized = value.trim().toLowerCase()
    const up = ['1', 'true', 'up', 'online', 'ok', 'active'].includes(normalized)
    const down = ['0', 'false', 'down', 'offline', 'inactive'].includes(normalized)
    const cls = up ? 'badge-running' : down ? 'badge-stopped' : 'badge-updating'
    return <span className={`badge ${cls}`}>{value}</span>
  }

  const sections = data ? Object.entries(data) : []

  return (
    <section className="official-status-panel">
      <div className="official-status-header">
        <h3>Official Server Status</h3>
        <button type="button" onClick={() => void refresh()} disabled={loading} title="Refresh from arkdedicated.com">
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      <p className="empty-state">Live status feed from Wildcard's official ARK:SA servers.</p>
      {error && <p className="error-message">{error}</p>}
      {!error && !loading && sections.length === 0 && <p className="empty-state">No data yet.</p>}
      {sections.map(([section, entries]) => (
        <div key={section} className="official-status-section">
          <h4>{section}</h4>
          <dl className="official-status-entries">
            {Object.entries(entries).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{badge(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  )
}
