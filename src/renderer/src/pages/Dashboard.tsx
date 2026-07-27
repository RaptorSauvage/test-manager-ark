import { useEffect, useState } from 'react'
import type { ServerProfile, ServerRunState } from '@shared/types'
import { useServerStatuses } from '../lib/useServerStatuses'
import { createDefaultProfile } from '../lib/profile'
import type { TabKey } from './ServerDetail'

interface DashboardProps {
  profiles: ServerProfile[]
  onProfilesChange: (profiles: ServerProfile[]) => void
  onOpenProfile: (id: string, tab?: TabKey) => void
  onOpenSteamCmd: () => void
}

export default function Dashboard({
  profiles,
  onProfilesChange,
  onOpenProfile,
  onOpenSteamCmd
}: DashboardProps): JSX.Element {
  const statuses = useServerStatuses(profiles.map((p) => p.id))
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  const [dragId, setDragId] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [logProfileId, setLogProfileId] = useState<string | null>(null)
  const [logContent, setLogContent] = useState('')
  const [installedById, setInstalledById] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let cancelled = false
    void Promise.all(
      profiles.map(async (p) => [p.id, await window.api.server.isInstalled(p.id)] as const)
    ).then((entries) => {
      if (!cancelled) setInstalledById(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles.map((p) => `${p.id}:${p.installDir}`).join(',')])

  async function refreshInstalled(profileId: string): Promise<void> {
    const installed = await window.api.server.isInstalled(profileId)
    setInstalledById((prev) => ({ ...prev, [profileId]: installed }))
  }

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

  async function handleImportFromFile(): Promise<void> {
    setImportError('')
    const filePath = await window.api.dialog.selectProfileFile()
    if (!filePath) return

    setImporting(true)
    try {
      const { profile, profiles: updated } = await window.api.profiles.importFromFile(filePath)
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
    await refreshInstalled(profile.id)
  }

  async function handleViewLog(profile: ServerProfile): Promise<void> {
    if (logProfileId === profile.id) {
      setLogProfileId(null)
      return
    }
    const log = await window.api.steamcmd.getUpdateLog(profile.id)
    setLogContent(log ?? 'No update log yet - run Update at least once.')
    setLogProfileId(profile.id)
  }

  function stateOf(profile: ServerProfile): ServerRunState {
    return statuses[profile.id]?.state ?? 'stopped'
  }

  async function runBulk(action: () => Promise<void>): Promise<void> {
    setBulkBusy(true)
    try {
      await action()
    } finally {
      setBulkBusy(false)
    }
  }

  async function startAll(): Promise<void> {
    const targets = profiles.filter((p) => stateOf(p) === 'stopped')
    await Promise.all(targets.map((p) => runAction(p, () => window.api.server.start(p.id))))
  }

  async function restartAll(): Promise<void> {
    const targets = profiles.filter((p) => stateOf(p) === 'running')
    await Promise.all(targets.map((p) => runAction(p, () => window.api.server.restart(p.id))))
  }

  async function stopAll(): Promise<void> {
    const targets = profiles.filter((p) => stateOf(p) === 'running')
    await Promise.all(targets.map((p) => runAction(p, () => window.api.server.stop(p.id))))
  }

  async function updateAll(): Promise<void> {
    const targets = profiles.filter((p) => stateOf(p) === 'stopped')
    await Promise.all(targets.map((p) => runAction(p, () => window.api.server.update(p.id))))
    await Promise.all(targets.map((p) => refreshInstalled(p.id)))
  }

  async function stopUpdateRestartAll(): Promise<void> {
    const wasRunning = profiles.filter((p) => stateOf(p) === 'running')
    await Promise.all(wasRunning.map((p) => runAction(p, () => window.api.server.stop(p.id))))

    // Stop above waits for each server to actually exit, so every profile is stopped now.
    await Promise.all(profiles.map((p) => runAction(p, () => window.api.server.update(p.id))))
    await Promise.all(profiles.map((p) => refreshInstalled(p.id)))

    await Promise.all(wasRunning.map((p) => runAction(p, () => window.api.server.start(p.id))))
  }

  async function handleDrop(targetId: string): Promise<void> {
    const sourceId = dragId
    setDragId(null)
    if (!sourceId || sourceId === targetId) return

    const ids = profiles.map((p) => p.id)
    const fromIndex = ids.indexOf(sourceId)
    const toIndex = ids.indexOf(targetId)
    ids.splice(toIndex, 0, ids.splice(fromIndex, 1)[0])

    const reordered = ids.map((id) => profiles.find((p) => p.id === id)!)
    onProfilesChange(reordered)
    const saved = await window.api.profiles.reorder(ids)
    onProfilesChange(saved)
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>ARK Server Manager</h1>
        <div className="dashboard-header-actions">
          <button onClick={onOpenSteamCmd}>SteamCMD</button>
          <button onClick={() => void handleImport()} disabled={importing}>
            {importing ? 'Scanning...' : 'Import existing server'}
          </button>
          <button onClick={() => void handleImportFromFile()} disabled={importing}>
            Import profile file...
          </button>
          <button onClick={() => void handleCreate()}>+ Add server</button>
        </div>
      </header>

      {importError && <p className="error-message">{importError}</p>}

      {profiles.length > 0 && (
        <section className="server-controls">
          <h3>Server Controls</h3>
          <div className="server-controls-actions">
            <button className="btn-start-all" disabled={bulkBusy} onClick={() => void runBulk(startAll)}>
              Start All
            </button>
            <button className="btn-restart-all" disabled={bulkBusy} onClick={() => void runBulk(restartAll)}>
              Restart All
            </button>
            <button className="btn-stop-all" disabled={bulkBusy} onClick={() => void runBulk(stopAll)}>
              Stop All
            </button>
            <button className="btn-update-all" disabled={bulkBusy} onClick={() => void runBulk(updateAll)}>
              Update All
            </button>
            <button
              className="btn-super-all"
              disabled={bulkBusy}
              onClick={() => void runBulk(stopUpdateRestartAll)}
              title="Stops every running server, updates all of them via SteamCMD, then starts the ones that were running back up"
            >
              Stop+Update+Restart All
            </button>
          </div>
        </section>
      )}

      {profiles.length === 0 && (
        <p className="empty-state">No server profiles yet. Click &quot;Add server&quot; to configure one.</p>
      )}

      <div className="server-grid">
        {profiles.map((profile) => {
          const status = statuses[profile.id]
          const state: ServerRunState = status?.state ?? 'stopped'
          return (
            <div
              className={`server-card${dragId === profile.id ? ' dragging' : ''}`}
              key={profile.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => void handleDrop(profile.id)}
            >
              <div className="server-card-header">
                <span
                  className="drag-handle"
                  draggable
                  onDragStart={() => setDragId(profile.id)}
                  onDragEnd={() => setDragId(null)}
                  title="Drag to reorder"
                >
                  ⠿
                </span>
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
                <button disabled={state !== 'stopped'} onClick={() => void handleAction(profile, 'start')}>
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
                  {installedById[profile.id] === false
                    ? state === 'updating'
                      ? 'Installing...'
                      : 'Install'
                    : state === 'updating'
                      ? 'Updating...'
                      : 'Update'}
                </button>
                <button onClick={() => void handleViewLog(profile)} title="Show the last SteamCMD update's output">
                  {logProfileId === profile.id ? 'Hide update log' : 'View update log'}
                </button>
                <button onClick={() => onOpenProfile(profile.id)}>Manage</button>
                <button className="danger" onClick={() => void handleDelete(profile.id)}>
                  Delete
                </button>
              </div>
              {logProfileId === profile.id && <pre className="log-output">{logContent}</pre>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
