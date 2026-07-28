import { useEffect, useState } from 'react'
import type { BackupEntry, ServerProfile } from '@shared/types'
import PlayerBackupsSection from './PlayerBackupsSection'

interface BackupsTabProps {
  profile: ServerProfile
  onProfileChange: (profile: ServerProfile) => void
}

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}

export default function BackupsTab({ profile, onProfileChange }: BackupsTabProps): JSX.Element {
  const [backups, setBackups] = useState<BackupEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [reloadToken, setReloadToken] = useState(0)

  const [form, setForm] = useState<ServerProfile>(profile)
  const [settingsStatus, setSettingsStatus] = useState('')

  function update<K extends keyof ServerProfile>(key: K, value: ServerProfile[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function reload(): void {
    setReloadToken((prev) => prev + 1)
  }

  // Re-fetches whenever the profile's own backupDir changes (not just on an explicit
  // Refresh click) - tied directly to the prop instead of relying on every action that
  // might change it remembering to also trigger a reload.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api.backup
      .list(profile.id)
      .then((list) => {
        if (cancelled) return
        setBackups(list)
        setSelectedPaths((prev) => new Set([...prev].filter((p) => list.some((b) => b.filePath === p))))
        setError('')
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [profile.id, profile.backupDir, reloadToken])

  useEffect(() => {
    return window.api.backup.onCreated((profileId) => {
      if (profileId === profile.id) reload()
    })
  }, [profile.id])

  async function persist(next: ServerProfile): Promise<void> {
    setError('')
    try {
      const updated = await window.api.profiles.save(next)
      const saved = updated.find((p) => p.id === next.id)
      if (saved) onProfileChange(saved)
      setSettingsStatus('Saved')
      setTimeout(() => setSettingsStatus(''), 2000)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function browseBackupDir(): Promise<void> {
    const dir = await window.api.dialog.selectDirectory()
    if (!dir) return
    const next = { ...form, backupDir: dir }
    setForm(next)
    await persist(next)
  }

  async function saveSettings(): Promise<void> {
    await persist(form)
  }

  async function handleCreate(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      const updated = await window.api.profiles.save(form)
      const saved = updated.find((p) => p.id === form.id)
      if (saved) onProfileChange(saved)
      await window.api.backup.create(form.id)
      reload()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleRestore(backup: BackupEntry): Promise<void> {
    if (!confirm(`Restore ${backup.fileName}? This overwrites the current save.`)) return
    setBusy(true)
    setError('')
    try {
      await window.api.backup.restore(profile.id, backup.filePath)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteSelected(): Promise<void> {
    const targets = backups.filter((b) => selectedPaths.has(b.filePath))
    if (targets.length === 0) return
    const label = targets.length === 1 ? targets[0].fileName : `${targets.length} backups`
    if (!confirm(`Delete ${label}?`)) return
    setError('')
    try {
      for (const backup of targets) {
        await window.api.backup.delete(backup.filePath)
      }
      reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function handleOpenFolder(): Promise<void> {
    setError('')
    try {
      await window.api.backup.openFolder(profile.id)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function toggleSelected(filePath: string): void {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(filePath)) next.delete(filePath)
      else next.add(filePath)
      return next
    })
  }

  function toggleSelectAll(): void {
    setSelectedPaths((prev) => (prev.size === backups.length ? new Set() : new Set(backups.map((b) => b.filePath))))
  }

  const singleSelected =
    selectedPaths.size === 1 ? (backups.find((b) => selectedPaths.has(b.filePath)) ?? null) : null

  return (
    <div className="backups-tab">
      <div className="backup-settings-row">
        <form
          className="settings-tab backup-settings"
          onSubmit={(e) => {
            e.preventDefault()
            void saveSettings()
          }}
        >
          <h3>World Backups</h3>
          <label>
            Backup directory
            <div className="path-input-row">
              <input value={form.backupDir} onChange={(e) => update('backupDir', e.target.value)} />
              <button type="button" onClick={() => void browseBackupDir()}>
                Browse...
              </button>
            </div>
          </label>
          <label>
            Max backups to keep
            <input
              type="number"
              value={form.maxBackups}
              onChange={(e) => update('maxBackups', Number(e.target.value))}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.backupScheduleEnabled}
              onChange={(e) => update('backupScheduleEnabled', e.target.checked)}
            />
            Enable scheduled automatic backups
          </label>
          <label>
            Backup schedule (cron expression)
            <input
              value={form.backupSchedule ?? ''}
              onChange={(e) => update('backupSchedule', e.target.value)}
              placeholder="every 6 hours: 0 */6 * * *"
              disabled={!form.backupScheduleEnabled}
            />
          </label>
          <div className="form-actions">
            <button type="submit">Save backup settings</button>
            {settingsStatus && <span className="status-message">{settingsStatus}</span>}
          </div>
        </form>

        <form
          className="settings-tab backup-settings"
          onSubmit={(e) => {
            e.preventDefault()
            void saveSettings()
          }}
        >
          <h3>Player Profile Backups</h3>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.playerProfileBackupEnabled}
              onChange={(e) => update('playerProfileBackupEnabled', e.target.checked)}
            />
            Back up player profiles on join/leave
          </label>
          <label>
            Backups to keep per player
            <input
              type="number"
              min={1}
              value={form.playerProfileBackupMaxPerPlayer}
              onChange={(e) => update('playerProfileBackupMaxPerPlayer', Number(e.target.value))}
              disabled={!form.playerProfileBackupEnabled}
            />
          </label>
          <p className="empty-state">
            Watches this server&apos;s own log for players joining/leaving and zips the{' '}
            <code>.profilebak</code> file ARK itself writes for that player into{' '}
            <code>PlayerBackups/&lt;player&gt;/</code> under the backup directory (left). Requires a backup
            directory to be set. Toggling this takes effect immediately, even while the server is running -
            no restart needed.
          </p>
          <div className="form-actions">
            <button type="submit">Save player profile backup settings</button>
            {settingsStatus && <span className="status-message">{settingsStatus}</span>}
          </div>
        </form>
      </div>

      <div className="form-actions">
        <button onClick={() => void handleCreate()} disabled={busy}>
          Create backup now
        </button>
        <span>
          Keeping the last {profile.maxBackups} backups in {profile.backupDir || '(not set)'}
        </span>
      </div>
      {error && <p className="error-message">{error}</p>}

      <div className="backup-sections">
        <section className="backup-management">
          <h3>World Backups</h3>
          <div className="backup-management-actions">
            <button className="btn-refresh-backups" onClick={reload} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh backup file list'}
            </button>
            <button
              className="btn-open-backup-folder"
              onClick={() => void handleOpenFolder()}
              disabled={!profile.backupDir}
            >
              Open backup folder
            </button>
            <button
              className="btn-restore-backup"
              disabled={!singleSelected || busy}
              title={selectedPaths.size > 1 ? 'Select just one backup to restore' : undefined}
              onClick={() => singleSelected && void handleRestore(singleSelected)}
            >
              Restore selected backup
            </button>
            <button
              className="btn-delete-backup"
              disabled={selectedPaths.size === 0}
              onClick={() => void handleDeleteSelected()}
            >
              Delete selected backup{selectedPaths.size > 1 ? `s (${selectedPaths.size})` : ''}
            </button>
          </div>
          <table className="backups-table">
            <thead>
              <tr>
                <th className="backups-select-col">
                  <input
                    type="checkbox"
                    checked={backups.length > 0 && selectedPaths.size === backups.length}
                    onChange={toggleSelectAll}
                    disabled={backups.length === 0}
                  />
                </th>
                <th>File Name</th>
                <th>Creation Time</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((backup) => (
                <tr
                  key={backup.filePath}
                  className={selectedPaths.has(backup.filePath) ? 'selected' : ''}
                  onClick={() => toggleSelected(backup.filePath)}
                  title={formatSize(backup.sizeBytes)}
                >
                  <td className="backups-select-col">
                    <input
                      type="checkbox"
                      checked={selectedPaths.has(backup.filePath)}
                      onChange={() => toggleSelected(backup.filePath)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td>
                    {backup.fileName}
                    {backup.legacy && (
                      <span
                        className="badge"
                        title="Recognized from a previous manager's naming convention - not counted against the backup limit above"
                      >
                        {' '}
                        legacy
                      </span>
                    )}
                  </td>
                  <td>{new Date(backup.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {!loading && backups.length === 0 && (
                <tr>
                  <td colSpan={3}>No backups yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <PlayerBackupsSection profile={profile} />
      </div>
    </div>
  )
}
