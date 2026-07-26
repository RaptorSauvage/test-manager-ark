import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'

interface AppSettingsViewProps {
  onBack: () => void
}

export default function AppSettingsView({ onBack }: AppSettingsViewProps): JSX.Element {
  const [settings, setSettings] = useState<AppSettings>({ steamCmdPath: '' })
  const [status, setStatus] = useState('')

  useEffect(() => {
    window.api.settings.get().then(setSettings)
  }, [])

  async function browse(): Promise<void> {
    const filePath = await window.api.dialog.selectFile()
    if (filePath) setSettings((prev) => ({ ...prev, steamCmdPath: filePath }))
  }

  async function save(): Promise<void> {
    const saved = await window.api.settings.save(settings)
    setSettings(saved)
    setStatus('Saved')
    setTimeout(() => setStatus(''), 2000)
  }

  return (
    <div className="server-detail">
      <header className="server-detail-header">
        <button onClick={onBack}>&larr; Back</button>
        <h1>Settings</h1>
      </header>
      <form
        className="settings-tab"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <label>
          SteamCMD path
          <div className="path-input-row">
            <input
              value={settings.steamCmdPath}
              onChange={(e) => setSettings({ ...settings, steamCmdPath: e.target.value })}
              placeholder="C:\SteamCMD\steamcmd.exe"
            />
            <button type="button" onClick={() => void browse()}>
              Browse...
            </button>
          </div>
        </label>
        <p className="empty-state">
          Used by each server&apos;s <strong>Update</strong> button to run steamcmd with{' '}
          <code>+force_install_dir &lt;install dir&gt; +login anonymous +app_update 2430930 validate +quit</code>.
          Works for a first install into an empty folder too.
        </p>
        <div className="form-actions">
          <button type="submit">Save</button>
          {status && <span className="status-message">{status}</span>}
        </div>
      </form>
    </div>
  )
}
