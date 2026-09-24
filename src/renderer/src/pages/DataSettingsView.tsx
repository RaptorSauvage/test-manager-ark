import { useEffect, useState } from 'react'
import type { AppSettings, AppUpdateStatus } from '@shared/types'
import AccessTokensSection from './AccessTokensSection'
import ApiKeysSection from './ApiKeysSection'

interface DataSettingsViewProps {
  onBack: () => void
}

function describeAppUpdateStatus(appUpdateStatus: AppUpdateStatus, appVersion: string): string {
  switch (appUpdateStatus.state) {
    case 'checking':
      return 'Checking for updates...'
    case 'available':
      return `Update ${appUpdateStatus.version} found - starting download...`
    case 'downloading':
      return `Downloading update ${appUpdateStatus.version ?? ''}... ${appUpdateStatus.percent ?? 0}%`
    case 'downloaded':
      return `Update ${appUpdateStatus.version} downloaded - save any unsaved changes, then click Restart & install.`
    case 'not-available':
      return `You're on the latest version (${appVersion}).`
    case 'error':
      return appUpdateStatus.error ?? 'Update check failed.'
    default:
      return ''
  }
}

export default function DataSettingsView({ onBack }: DataSettingsViewProps): JSX.Element {
  const [settings, setSettings] = useState<AppSettings>({
    steamCmdPath: '',
    dataDir: '',
    webDashboardEnabled: false,
    webDashboardPort: 8090,
    webDashboardHost: '127.0.0.1',
    webDashboardDisabledLabels: [],
    launchOnStartup: false,
    webDashboardAuthEnabled: false,
    serverAutoStartStaggerSeconds: 10,
    iniLockEnabled: true,
    statsHistoryMaxSizeMB: 1024,
    statsHistoryMaxAgeHours: 24
  })
  const [defaultDataDir, setDefaultDataDir] = useState('')
  const [status, setStatus] = useState('')
  const [webDashboardStatus, setWebDashboardStatus] = useState<{
    running: boolean
    error: string | null
    host: string | null
  }>({ running: false, error: null, host: null })
  const [localIps, setLocalIps] = useState<string[]>([])
  const [appVersion, setAppVersion] = useState('')
  const [appUpdateStatus, setAppUpdateStatus] = useState<AppUpdateStatus>({ state: 'idle' })

  useEffect(() => {
    window.api.settings.get().then(setSettings)
    window.api.dataDir.getDefault().then(setDefaultDataDir)
    window.api.webDashboard.getStatus().then(setWebDashboardStatus)
    window.api.webDashboard.getLocalIps().then(setLocalIps)
    window.api.appUpdate.getVersion().then(setAppVersion)
    window.api.appUpdate.getStatus().then(setAppUpdateStatus)
    return window.api.appUpdate.onStatusChanged(setAppUpdateStatus)
  }, [])

  const appUpdateBusy = appUpdateStatus.state === 'checking' || appUpdateStatus.state === 'available' || appUpdateStatus.state === 'downloading'

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

  const isLan = settings.webDashboardHost.trim() !== '' && settings.webDashboardHost.trim() !== '127.0.0.1'

  return (
    <div className="server-detail">
      <header className="server-detail-header">
        <button onClick={onBack}>&larr; Back</button>
        <h1>Settings</h1>
      </header>

      <div className="app-settings-view">
        <form
          className="app-settings-form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <section className="cluster-section">
            <h3>Data &amp; Storage</h3>
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
              Where <code>maps.json</code>, <code>customMaps.json</code>, and other config live - blank uses{' '}
              {defaultDataDir || 'Documents/ARK Server Manager'}.
            </p>
            <div className="settings-grid">
              <label>
                Stats history size limit (MB)
                <input
                  type="number"
                  min={1}
                  value={settings.statsHistoryMaxSizeMB}
                  onChange={(e) => setSettings({ ...settings, statsHistoryMaxSizeMB: Number(e.target.value) })}
                />
              </label>
              <label>
                Stats history retention (hours)
                <input
                  type="number"
                  min={0}
                  value={settings.statsHistoryMaxAgeHours}
                  onChange={(e) => setSettings({ ...settings, statsHistoryMaxAgeHours: Number(e.target.value) })}
                />
              </label>
            </div>
            <p className="empty-state">
              Combined cap on every server&apos;s CPU/RAM/player history (Analytics tab) - oldest samples trimmed
              first once either limit is hit. Retention defaults to 24h, keeping a long-running Manager from
              re-parsing an ever-growing file every time a stats chart is open. Set retention to 0 to keep history
              bounded by size alone, however long that ends up spanning.
            </p>
            <label>
              Server profiles
              <div className="path-input-row">
                <button type="button" onClick={() => void window.api.system.openProfilesFolder()}>
                  Open profiles folder
                </button>
              </div>
            </label>
            <p className="empty-state">Opens this app&apos;s own data folder (profiles, settings, config.json).</p>
          </section>

          <section className="cluster-section">
            <h3>Startup &amp; Safety</h3>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.launchOnStartup}
                onChange={(e) => setSettings({ ...settings, launchOnStartup: e.target.checked })}
              />
              Start Manager when you log into Windows
            </label>
            <label>
              Delay between auto-started servers (seconds)
              <input
                type="number"
                min={0}
                value={settings.serverAutoStartStaggerSeconds}
                onChange={(e) => setSettings({ ...settings, serverAutoStartStaggerSeconds: Number(e.target.value) })}
              />
            </label>
            <p className="empty-state">
              Wait between each profile with &quot;Start this server when the Manager starts&quot; enabled (Server
              Management tab), so monitoring is ready before each one starts.
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.iniLockEnabled}
                onChange={(e) => setSettings({ ...settings, iniLockEnabled: e.target.checked })}
              />
              Lock config files while a server is running
            </label>
            <p className="empty-state">
              Makes <code>GameUserSettings.ini</code>/<code>Game.ini</code> read-only while that server runs, as a
              guard against editing it by accident.
            </p>
          </section>

          <section className="cluster-section">
            <h3>Web Dashboard</h3>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.webDashboardEnabled}
                onChange={(e) => setSettings({ ...settings, webDashboardEnabled: e.target.checked })}
              />
              Enable web dashboard
            </label>
            <p className="empty-state">
              A browser-accessible page (live console + RCON, one server at a time) - same content as the desktop
              console, reachable from any device with a web browser.
            </p>
            <div className="settings-grid">
              <label>
                Host
                <input
                  value={settings.webDashboardHost}
                  onChange={(e) => setSettings({ ...settings, webDashboardHost: e.target.value })}
                  placeholder="127.0.0.1"
                  disabled={!settings.webDashboardEnabled}
                />
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
            </div>
            <p className="empty-state">
              <code>127.0.0.1</code> (default) keeps it reachable from this machine only; <code>0.0.0.0</code> or a
              specific local IP also allows other devices on your network.
              {localIps.length > 0 && (
                <>
                  {' '}
                  This machine&apos;s local IP{localIps.length > 1 ? 's' : ''}:{' '}
                  {localIps.map((ip, i) => (
                    <span key={ip}>
                      <code>{ip}</code>
                      {i < localIps.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                  .
                </>
              )}
            </p>
            {isLan && !settings.webDashboardAuthEnabled && (
              <p className="error-message">
                Host is set to {settings.webDashboardHost} - reachable from your network with no access token
                required.
              </p>
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.webDashboardAuthEnabled}
                onChange={(e) => setSettings({ ...settings, webDashboardAuthEnabled: e.target.checked })}
                disabled={!settings.webDashboardEnabled}
              />
              Require access token (HTTPS)
            </label>
            <p className="empty-state">
              Switches to <code>https://</code> (self-signed - browsers will warn once) and requires pasting an
              access token (below) into every browser that opens the dashboard. Needed before exposing this outside
              your LAN.
            </p>
            {settings.webDashboardEnabled && (
              <p className={webDashboardStatus.error ? 'error-message' : 'empty-state'}>
                {webDashboardStatus.error
                  ? `Failed to start: ${webDashboardStatus.error}`
                  : webDashboardStatus.running
                    ? `Running at ${settings.webDashboardAuthEnabled ? 'https' : 'http'}://${webDashboardStatus.host}:${settings.webDashboardPort}`
                    : 'Not running yet - save to start it.'}
              </p>
            )}
          </section>

          <div className="form-actions">
            <button type="submit">Save</button>
            {status && <span className="status-message">{status}</span>}
          </div>
        </form>

        <AccessTokensSection />
        <ApiKeysSection />

        <section className="managed-steamcmd">
          <h3>Manager updates</h3>
          <p className="empty-state">
            Current version: <code>{appVersion || '...'}</code>. Checks GitHub for a newer release and downloads it
            - installing (below) restarts the Manager, as a separate step so it never happens automatically.
          </p>
          {appUpdateStatus.state !== 'idle' && (
            <p className={appUpdateStatus.state === 'error' ? 'error-message' : 'empty-state'}>
              {describeAppUpdateStatus(appUpdateStatus, appVersion)}
            </p>
          )}
          <button onClick={() => void window.api.appUpdate.check()} disabled={appUpdateBusy}>
            {appUpdateBusy ? 'Working...' : 'Check for updates'}
          </button>
          {appUpdateStatus.state === 'downloaded' && (
            <button onClick={() => void window.api.appUpdate.install()}>Restart &amp; install now</button>
          )}
        </section>
      </div>
    </div>
  )
}
