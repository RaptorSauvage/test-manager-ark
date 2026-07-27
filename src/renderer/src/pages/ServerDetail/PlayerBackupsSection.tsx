import { useEffect, useState } from 'react'
import type { BackupEntry, PlayerBackupFolder, ServerProfile } from '@shared/types'

interface PlayerBackupsSectionProps {
  profile: ServerProfile
}

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}

export default function PlayerBackupsSection({ profile }: PlayerBackupsSectionProps): JSX.Element {
  const [folders, setFolders] = useState<PlayerBackupFolder[]>([])
  const [selectedFolder, setSelectedFolder] = useState('')
  const [backups, setBackups] = useState<BackupEntry[]>([])
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  function reload(): void {
    setReloadToken((prev) => prev + 1)
  }

  async function refreshFolders(): Promise<void> {
    try {
      const list = await window.api.playerBackup.listFolders(profile.id)
      setFolders(list)
      setSelectedFolder((prev) => (prev && list.some((f) => f.key === prev) ? prev : (list[0]?.key ?? '')))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    void refreshFolders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id])

  useEffect(() => {
    if (!selectedFolder) {
      setBackups([])
      return
    }
    let cancelled = false
    setLoading(true)
    window.api.playerBackup
      .list(profile.id, selectedFolder)
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
  }, [profile.id, selectedFolder, reloadToken])

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

  async function handleRestore(backup: BackupEntry): Promise<void> {
    if (!confirm(`Restore ${backup.fileName}? This overwrites this player's current profile.`)) return
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
      await window.api.playerBackup.openFolder(profile.id, selectedFolder)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section className="backup-management player-backup-management">
      <h3>Player Profile Backups</h3>
      <div className="path-input-row">
        <select
          value={selectedFolder}
          onChange={(e) => setSelectedFolder(e.target.value)}
          disabled={folders.length === 0}
        >
          {folders.length === 0 && <option value="">No players backed up yet</option>}
          {folders.map((f) => (
            <option key={f.key} value={f.key}>
              {f.playerName}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void refreshFolders()} title="Reload the list of players">
          Refresh
        </button>
      </div>
      {error && <p className="error-message">{error}</p>}
      <div className="backup-management-actions">
        <button className="btn-refresh-backups" onClick={reload} disabled={!selectedFolder || loading}>
          {loading ? 'Refreshing...' : 'Refresh backup file list'}
        </button>
        <button
          className="btn-open-backup-folder"
          onClick={() => void handleOpenFolder()}
          disabled={!selectedFolder}
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
              <td>{backup.fileName}</td>
              <td>{new Date(backup.createdAt).toLocaleString()}</td>
            </tr>
          ))}
          {!loading && backups.length === 0 && (
            <tr>
              <td colSpan={3}>{selectedFolder ? 'No backups yet.' : 'No player has been backed up yet.'}</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}
