import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'

interface DataSettingsViewProps {
  onBack: () => void
}

export default function DataSettingsView({ onBack }: DataSettingsViewProps): JSX.Element {
  const [settings, setSettings] = useState<AppSettings>({ steamCmdPath: '', dataDir: '' })
  const [defaultDataDir, setDefaultDataDir] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    window.api.settings.get().then(setSettings)
    window.api.dataDir.getDefault().then(setDefaultDataDir)
  }, [])

  async function browse(): Promise<void> {
    const dir = await window.api.dialog.selectDirectory()
    if (dir) setSettings((prev) => ({ ...prev, dataDir: dir }))
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
          Data files location
          <div className="path-input-row">
            <input
              value={settings.dataDir}
              onChange={(e) => setSettings({ ...settings, dataDir: e.target.value })}
              placeholder={defaultDataDir}
            />
            <button type="button" onClick={() => void browse()}>
              Browse...
            </button>
          </div>
        </label>
        <p className="empty-state">
          Where <code>maps.json</code>, <code>customMaps.json</code>, and any future editable config files live.
          Leave blank to use the default ({defaultDataDir || 'Documents/ARK Server Manager'}). Changing this only
          affects where the app looks going forward - it won&apos;t move any existing files for you.
        </p>
        <div className="form-actions">
          <button type="submit">Save</button>
          {status && <span className="status-message">{status}</span>}
        </div>
      </form>
    </div>
  )
}
