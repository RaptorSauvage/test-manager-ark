import { useState } from 'react'
import type { ServerProfile, ServerRunState } from '@shared/types'
import { useServerStatuses } from '../lib/useServerStatuses'
import { createDefaultProfile } from '../lib/profile'
import type { TabKey } from './ServerDetail'

interface DashboardProps {
  profiles: ServerProfile[]
  onProfilesChange: (profiles: ServerProfile[]) => void
  onOpenProfile: (id: string, tab?: TabKey) => void
  onOpenSettings: () => void
}

export default function Dashboard({
  profiles,
  onProfilesChange,
  onOpenProfile,
  onOpenSettings
}: DashboardProps): JSX.Element {
  const statuses = useServerStatuses(profiles.map((p) => p.id))
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})

  async function handleCreate(): Promise<void> {
    const profile = createDefaultProfile(`Server ${profiles.length + 1}`)
    const updated = await window.api.profiles.save(profile)
    onProfilesChange(updated)
    onOpenProfile(profile.id, 'settings')
  }

  async function handleImport(): Promise<void> {
    setImportError('')
    const installDir = await window.api.dialog.selectDirectory()
    if (!installDir) return

    setImporting(true)
    try {
      const { profile, profiles: updated } = await window.api.profiles.importFromInstall(installDir)
      onProfilesChange(updated)
      onOpenProfile(profile.id, 'settings')
    } catch (err) {
      setImportError((err as Error).message)
    } finally {
      setImporting(false)
    }
  }

  async function handleDelete(id: string): Promise<void> {
    if (!confirm('Delete this server profile? This does not delete any files on disk.')) return
    const updated = await window.api.profiles.delete(id)
    onProfilesChange(updated)
  }

  async function runAction(profile: ServerProfile, action: () => Promise<unknown>): Promise<void> {
    setActionErrors((prev) => ({ ...prev, [profile.id]: '' }))
    try {
      await action()
    } catch (err) {
      setActionErrors((prev) => ({ ...prev, [profile.id]: (err as Error).message }))
    }
  }

  async function handleAction(profile: ServerProfile, action: 'start' | 'stop' | 'restart'): Promise<void> {
    await runAction(profile, () => window.api.server[action](profile.id))
  }

  async function handleKill(profile: ServerProfile): Promise<void> {
    if (!confirm(`Force-kill "${profile.name}" without saving? Progress since the last save will be lost.`)) return
    await runAction(profile, () => window.api.server.kill(profile.id))
  }

  async function handleUpdate(profile: ServerProfile): Promise<void> {
    await runAction(profile, () => window.api.server.update(profile.id))
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>ARK Server Manager</h1>
        <div className="dashboard-header-actions">
          <button onClick={onOpenSettings}>Settings</button>
          <button onClick={() => void handleImport()} disabled={importing}>
            {importing ? 'Scanning...' : 'Import existing server'}
          </button>
          <button onClick={() => void handleCreate()}>+ Add server</button>
        </div>
      </header>

      {importError && <p className="error-message">{importError}</p>}

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
              {actionErrors[profile.id] && <p className="error-message">{actionErrors[profile.id]}</p>}
              <div className="server-card-actions">
                <button
                  disabled={state === 'running' || state === 'starting' || state === 'updating'}
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
                <button
                  className="danger"
                  disabled={state === 'stopped' || state === 'updating'}
                  onClick={() => void handleKill(profile)}
                  title="Force-kill immediately, without saving"
                >
                  Kill
                </button>
                <button
                  disabled={state !== 'stopped'}
                  onClick={() => void handleUpdate(profile)}
                  title="Install/update the server files via SteamCMD"
                >
                  {state === 'updating' ? 'Updating...' : 'Update'}
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
