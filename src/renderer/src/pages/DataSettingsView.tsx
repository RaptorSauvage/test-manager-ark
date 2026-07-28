import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'

interface DataSettingsViewProps {
  onBack: () => void
}

export default function DataSettingsView({ onBack }: DataSettingsViewProps): JSX.Element {
  const [settings, setSettings] = useState<AppSettings>({
    steamCmdPath: '',
    dataDir: '',
    webDashboardEnabled: false,
    webDashboardPort: 8090
  })
  const [defaultDataDir, setDefaultDataDir] = useState('')
  const [status, setStatus] = useState('')
  const [webDashboardStatus, setWebDashboardStatus] = useState<{ running: boolean; error: string | null }>({
    running: false,
    error: null
  })

  useEffect(() => {
    window.api.settings.get().then(setSettings)
    window.api.dataDir.getDefault().then(setDefaultDataDir)
    window.api.webDashboard.getStatus().then(setWebDashboardStatus)
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
    setWebDashboardStatus(await window.api.webDashboard.getStatus())
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

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.webDashboardEnabled}
            onChange={(e) => setSettings({ ...settings, webDashboardEnabled: e.target.checked })}
          />
          Enable web dashboard
        </label>
        <label>
          Port
          <input
            type="number"
            min={1}
            max={65535}
            value={settings.webDashboardPort}
            onChange={(e) => setSettings({ ...settings, webDashboardPort: Number(e.target.value) })}
            disabled={!settings.webDashboardEnabled}
          />
        </label>
        <p className="empty-state">
          A browser-accessible page (live console feed + RCON command box, one server at a time) - the same
          content as the Console &amp; RCON tab, reachable from a normal web browser instead of only from inside
          this app. Always bound to <code>127.0.0.1</code> only, never other network interfaces - it has no login
          of its own, so anything reachable at that address has full RCON/admin control of your servers. Save
          this form to apply a change immediately, no restart needed.
        </p>
        {settings.webDashboardEnabled && (
          <p className={webDashboardStatus.error ? 'error-message' : 'empty-state'}>
            {webDashboardStatus.error
              ? `Failed to start: ${webDashboardStatus.error}`
              : webDashboardStatus.running
                ? `Running at http://127.0.0.1:${settings.webDashboardPort}`
                : 'Not running yet - save to start it.'}
          </p>
        )}

        <div className="form-actions">
          <button type="submit">Save</button>
          {status && <span className="status-message">{status}</span>}
        </div>
      </form>
    </div>
  )
}
