import { useEffect, useState } from 'react'
import type { OfficialServerStatus } from '@shared/types'

export default function OfficialServerStatusPanel(): JSX.Element {
  const [data, setData] = useState<OfficialServerStatus | null>(null)
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

  return (
    <section className="official-status-panel">
      <div className="official-status-header">
        <h3>Official Server Status</h3>
        <button type="button" onClick={() => void refresh()} disabled={loading} title="Refresh from arkdedicated.com">
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      <p className="empty-state">Live status feed from Wildcard&apos;s official ARK:SA servers.</p>
      {error && <p className="error-message">{error}</p>}
      {data && (
        <p className="official-status-line">
          {data.label} :{' '}
          <span className="official-status-value" style={{ color: data.color }}>
            {data.status} ({data.version})
          </span>
        </p>
      )}
    </section>
  )
}
