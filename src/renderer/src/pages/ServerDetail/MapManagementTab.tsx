import { useEffect, useState } from 'react'
import type { MapFolderEntry, ServerProfile } from '@shared/types'

interface MapManagementTabProps {
  profile: ServerProfile
}

export default function MapManagementTab({ profile }: MapManagementTabProps): JSX.Element {
  const [folders, setFolders] = useState<MapFolderEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [folderName, setFolderName] = useState('')
  const [fileName, setFileName] = useState('')
  const [adding, setAdding] = useState(false)
  const [selected, setSelected] = useState('')

  async function refresh(): Promise<void> {
    setLoading(true)
    try {
      const list = await window.api.mapManagement.list(profile.id)
      setFolders(list)
      setSelected((prev) => (list.some((f) => f.name === prev) ? prev : ''))
      setError('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id])

  async function handleAdd(): Promise<void> {
    if (!folderName.trim() || !fileName.trim()) return
    setAdding(true)
    setError('')
    try {
      await window.api.mapManagement.create(profile.id, folderName, fileName)
      setFolderName('')
      setFileName('')
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setAdding(false)
    }
  }

  async function handleOpenFolder(): Promise<void> {
    if (!selected) return
    setError('')
    try {
      await window.api.mapManagement.openFolder(profile.id, selected)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function handleDelete(): Promise<void> {
    if (!selected) return
    if (!confirm(`Delete the "${selected}" map folder and everything in it?`)) return
    setError('')
    try {
      await window.api.mapManagement.delete(profile.id, selected)
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section className="cluster-section">
      <h3>Map Management</h3>
      <label>
        Create map folder (example: Svartalfheim)
        <input value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="Svartalfheim" />
      </label>
      <label>
        Create map file (example: Svartalfheim_WP.ark)
        <input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="Svartalfheim_WP.ark" />
      </label>
      <div className="form-actions">
        <button type="button" onClick={() => void handleAdd()} disabled={adding || !folderName.trim() || !fileName.trim()}>
          {adding ? 'Adding...' : 'Add map'}
        </button>
      </div>
      <p className="empty-state">
        Creates <code>SavedArks/&lt;folder&gt;/&lt;file&gt;</code> (an empty placeholder) under this server's install
        directory. After adding a custom map here, don&apos;t forget to also add its mod in the Mods tab - that's
        what actually downloads the map and keeps it up to date.
      </p>
      {error && <p className="error-message">{error}</p>}
      <div className="backup-management-actions">
        <button className="btn-refresh-backups" onClick={() => void refresh()} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
        <button className="btn-open-backup-folder" onClick={() => void handleOpenFolder()} disabled={!selected}>
          Open map folder
        </button>
        <button className="btn-delete-backup" onClick={() => void handleDelete()} disabled={!selected}>
          Delete selected map
        </button>
      </div>
      <table className="backups-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Creation Date</th>
          </tr>
        </thead>
        <tbody>
          {folders.map((folder) => (
            <tr
              key={folder.name}
              className={selected === folder.name ? 'selected' : ''}
              onClick={() => setSelected(folder.name)}
            >
              <td>{folder.name}</td>
              <td>{new Date(folder.createdAt).toLocaleString()}</td>
            </tr>
          ))}
          {!loading && folders.length === 0 && (
            <tr>
              <td colSpan={2}>No map folders under SavedArks yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}
