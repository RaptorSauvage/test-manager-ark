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
    const updated = await window.api.profiles.save(form)
    const saved = updated.find((p) => p.id === form.id)
    if (saved) onProfileChange(saved)
    setSettingsStatus('Saved')
    setTimeout(() => setSettingsStatus(''), 2000)
  }

  const refresh = useCallback(async () => {
    const list = await window.api.backup.list(profile.id)
    setBackups(list)
  }, [profile.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function handleCreate(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      await window.api.backup.create(profile.id)
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

  async function handleDelete(backup: BackupEntry): Promise<void> {
    if (!confirm(`Delete ${backup.fileName}?`)) return
    await window.api.backup.delete(backup.filePath)
    await refresh()
  }

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
      <table className="backups-table">
        <thead>
          <tr>
            <th>File</th>
            <th>Created</th>
            <th>Size</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {backups.map((backup) => (
            <tr key={backup.filePath}>
              <td>{backup.fileName}</td>
              <td>{new Date(backup.createdAt).toLocaleString()}</td>
              <td>{formatSize(backup.sizeBytes)}</td>
              <td className="backups-actions">
                <button onClick={() => void handleRestore(backup)} disabled={busy}>
                  Restore
                </button>
                <button className="danger" onClick={() => void handleDelete(backup)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {backups.length === 0 && (
            <tr>
              <td colSpan={4}>No backups yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
