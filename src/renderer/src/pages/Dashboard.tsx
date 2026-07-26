import type { ServerProfile, ServerRunState } from '@shared/types'
import { useServerStatuses } from '../lib/useServerStatuses'
import { createDefaultProfile } from '../lib/profile'

interface DashboardProps {
  profiles: ServerProfile[]
  onProfilesChange: (profiles: ServerProfile[]) => void
  onOpenProfile: (id: string) => void
}

export default function Dashboard({ profiles, onProfilesChange, onOpenProfile }: DashboardProps): JSX.Element {
  const statuses = useServerStatuses(profiles.map((p) => p.id))

  async function handleCreate(): Promise<void> {
    const profile = createDefaultProfile(`Server ${profiles.length + 1}`)
    const updated = await window.api.profiles.save(profile)
    onProfilesChange(updated)
    onOpenProfile(profile.id)
  }

  async function handleDelete(id: string): Promise<void> {
    if (!confirm('Delete this server profile? This does not delete any files on disk.')) return
    const updated = await window.api.profiles.delete(id)
    onProfilesChange(updated)
  }

  async function handleAction(profile: ServerProfile, action: 'start' | 'stop' | 'restart'): Promise<void> {
    await window.api.server[action](profile.id)
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>ARK Server Manager</h1>
        <button onClick={() => void handleCreate()}>+ Add server</button>
      </header>

      {profiles.length === 0 && (
        <p className="empty-state">No server profiles yet. Click &quot;Add server&quot; to configure one.</p>
      )}

      <div className="server-grid">
        {profiles.map((profile) => {
          const status = statuses[profile.id]
          const state: ServerRunState = status?.state ?? 'stopped'
          return (
            <div className="server-card" key={profile.id}>
              <div className="server-card-header">
                <h2>{profile.name}</h2>
                <span className={`badge badge-${state}`}>{state}</span>
              </div>
              <dl className="server-card-info">
                <div>
                  <dt>Map</dt>
                  <dd>{profile.map || '(not set)'}</dd>
                </div>
                <div>
                  <dt>Port</dt>
                  <dd>{profile.gamePort}</dd>
                </div>
                {status?.players && (
                  <div>
                    <dt>Players</dt>
                    <dd>{status.players.length}</dd>
                  </div>
                )}
                {status?.cpu !== undefined && (
                  <div>
                    <dt>CPU</dt>
                    <dd>{status.cpu}%</dd>
                  </div>
                )}
                {status?.memoryMB !== undefined && (
                  <div>
                    <dt>RAM</dt>
                    <dd>{status.memoryMB} MB</dd>
                  </div>
                )}
              </dl>
              {status?.lastError && <p className="error-message">{status.lastError}</p>}
              <div className="server-card-actions">
                <button
                  disabled={state === 'running' || state === 'starting'}
                  onClick={() => void handleAction(profile, 'start')}
                >
                  Start
                </button>
                <button disabled={state !== 'running'} onClick={() => void handleAction(profile, 'stop')}>
                  Stop
                </button>
                <button disabled={state !== 'running'} onClick={() => void handleAction(profile, 'restart')}>
                  Restart
                </button>
                <button onClick={() => onOpenProfile(profile.id)}>Manage</button>
                <button className="danger" onClick={() => void handleDelete(profile.id)}>
                  Delete
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
