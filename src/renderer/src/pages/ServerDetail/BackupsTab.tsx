import { useCallback, useEffect, useState } from 'react'
import type { BackupEntry, ServerProfile } from '@shared/types'

interface BackupsTabProps {
  profile: ServerProfile
}

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}

export default function BackupsTab({ profile }: BackupsTabProps): JSX.Element {
  const [backups, setBackups] = useState<BackupEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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
