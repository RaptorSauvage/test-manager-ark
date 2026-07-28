import { useState } from 'react'
import type { ServerProfile } from '@shared/types'

interface ProfileManagementViewProps {
  profiles: ServerProfile[]
  onProfilesChange: (profiles: ServerProfile[]) => void
  onBack: () => void
}

type Action = 'copy' | 'move'

export default function ProfileManagementView({
  profiles,
  onProfilesChange,
  onBack
}: ProfileManagementViewProps): JSX.Element {
  const [selectedId, setSelectedId] = useState(profiles[0]?.id ?? '')
  const [action, setAction] = useState<Action>('copy')
  const [destInstallDir, setDestInstallDir] = useState('')
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  const selected = profiles.find((p) => p.id === selectedId) ?? null

  function selectProfile(id: string): void {
    setSelectedId(id)
    const profile = profiles.find((p) => p.id === id)
    setNewName(profile ? `${profile.name} copy` : '')
    setDestInstallDir('')
    setError('')
    setStatus('')
  }

  async function browseDestination(): Promise<void> {
    const dir = await window.api.dialog.selectDirectory()
    if (dir) setDestInstallDir(dir)
  }

  async function submit(): Promise<void> {
    if (!selected) return
    setError('')
    setStatus('')
    setBusy(true)
    try {
      const result =
        action === 'copy'
          ? await window.api.profiles.copy(selected.id, destInstallDir, newName)
          : await window.api.profiles.move(selected.id, destInstallDir, newName)
      onProfilesChange(result.profiles)
      setStatus(
        action === 'copy'
          ? `Copied "${selected.name}" to a new profile "${result.profile.name}".`
          : `Moved "${selected.name}" to "${destInstallDir}"${newName !== selected.name ? ` and renamed it to "${result.profile.name}"` : ''}.`
      )
      setDestInstallDir('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="server-detail">
      <header className="server-detail-header">
        <button onClick={onBack}>&larr; Back</button>
        <h1>Profile Management</h1>
      </header>

      <form
        className="settings-tab"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {profiles.length === 0 && <p className="empty-state">No server profiles yet.</p>}

        {profiles.length > 0 && (
          <>
            <label>
              Select profile
              <select value={selectedId} onChange={(e) => selectProfile(e.target.value)}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            {selected && (
              <>
                <p className="empty-state">
                  Current install folder: <code>{selected.installDir}</code>
                </p>

                <label className="checkbox">
                  <input
                    type="radio"
                    name="action"
                    checked={action === 'copy'}
                    onChange={() => setAction('copy')}
                  />
                  Copy - duplicates the entire server install as a brand new, separate profile. The original is
                  untouched.
                </label>
                <label className="checkbox">
                  <input
                    type="radio"
                    name="action"
                    checked={action === 'move'}
                    onChange={() => setAction('move')}
                  />
                  Move - relocates (and optionally renames) this same profile&apos;s files. Nothing is duplicated.
                </label>

                <label>
                  Destination folder
                  <div className="path-input-row">
                    <input
                      value={destInstallDir}
                      onChange={(e) => setDestInstallDir(e.target.value)}
                      placeholder="Where the entire server install gets copied/moved to"
                    />
                    <button type="button" onClick={() => void browseDestination()}>
                      Browse...
                    </button>
                  </div>
                </label>

                <label>
                  {action === 'copy' ? 'New profile name' : 'Profile name'}
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} />
                </label>

                <p className="empty-state">
                  This copies/moves every file under the install folder (server binaries, saves, configs - the
                  whole thing), so it can take a while for a large install. The server must be stopped first.
                </p>

                {error && <p className="error-message">{error}</p>}

                <div className="form-actions">
                  <button type="submit" disabled={busy || !destInstallDir.trim() || !newName.trim()}>
                    {busy
                      ? action === 'copy'
                        ? 'Copying...'
                        : 'Moving...'
                      : action === 'copy'
                        ? 'Copy profile'
                        : 'Move profile'}
                  </button>
                  {status && <span className="status-message">{status}</span>}
                </div>
              </>
            )}
          </>
        )}
      </form>
    </div>
  )
}
