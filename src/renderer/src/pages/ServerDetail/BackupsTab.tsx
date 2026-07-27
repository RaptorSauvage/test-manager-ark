import { useCallback, useEffect, useState } from 'react'
import type { BackupEntry, ServerProfile } from '@shared/types'

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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())

  const [form, setForm] = useState<ServerProfile>(profile)
  const [settingsStatus, setSettingsStatus] = useState('')

  function update<K extends keyof ServerProfile>(key: K, value: ServerProfile[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function browseBackupDir(): Promise<void> {
    const dir = await window.api.dialog.selectDirectory()
    if (dir) update('backupDir', dir)
  }

  async function saveSettings(): Promise<void> {
    setError('')
    try {
      const updated = await window.api.profiles.save(form)
      const saved = updated.find((p) => p.id === form.id)
      if (saved) onProfileChange(saved)
      setSettingsStatus('Saved')
      setTimeout(() => setSettingsStatus(''), 2000)
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const refresh = useCallback(async () => {
    const list = await window.api.backup.list(profile.id)
    setBackups(list)
    setSelectedPaths((prev) => new Set([...prev].filter((p) => list.some((b) => b.filePath === p))))
  }, [profile.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    return window.api.backup.onCreated((profileId) => {
      if (profileId === profile.id) void refresh()
    })
  }, [profile.id, refresh])

  async function handleCreate(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      const updated = await window.api.profiles.save(form)
      const saved = updated.find((p) => p.id === form.id)
      if (saved) onProfileChange(saved)
      await window.api.backup.create(form.id)
      await refresh()
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
    for (const backup of targets) {
      await window.api.backup.delete(backup.filePath)
    }
    await refresh()
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
      <form
        className="settings-tab backup-settings"
        onSubmit={(e) => {
          e.preventDefault()
          void saveSettings()
        }}
      >
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

      <div className="form-actions">
        <button onClick={() => void handleCreate()} disabled={busy}>
          Create backup now
        </button>
        <span>
          Keeping the last {profile.maxBackups} backups in {profile.backupDir || '(not set)'}
        </span>
      </div>
      {error && <p className="error-message">{error}</p>}

      <section className="backup-management">
        <div className="backup-management-actions">
          <button className="btn-refresh-backups" onClick={() => void refresh()}>
            Refresh backup file list
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
          <button className="btn-delete-backup" disabled={selectedPaths.size === 0} onClick={() => void handleDeleteSelected()}>
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
                <td>{backup.fileName}</td>
                <td>{new Date(backup.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {backups.length === 0 && (
              <tr>
                <td colSpan={3}>No backups yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
