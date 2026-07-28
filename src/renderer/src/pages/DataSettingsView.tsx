import { useEffect, useState } from 'react'
import type { AppSettings, AppUpdateStatus } from '@shared/types'

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
      return `Update ${appUpdateStatus.version} downloaded - installing and restarting...`
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
    launchOnStartup: false
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
            checked={settings.launchOnStartup}
            onChange={(e) => setSettings({ ...settings, launchOnStartup: e.target.checked })}
          />
          Start Manager when you log into Windows
        </label>
        <p className="empty-state">
          Registers this app to launch automatically at login (minimized to the background isn&apos;t supported yet
          - it opens its normal window). Save this form to apply the change immediately.
        </p>

        <label>
          Server profiles
          <div className="path-input-row">
            <button type="button" onClick={() => void window.api.system.openProfilesFolder()}>
              Open profiles folder
            </button>
          </div>
        </label>
        <p className="empty-state">
          Opens the folder holding this app&apos;s own data file (profiles, app settings, and which pid belongs to
          which running server) - a single <code>config.json</code>, written by the underlying storage library this
          app uses. It&apos;s already plain JSON today, just not broken out into one file per profile the way an
          exported profile is.
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
        <p className="empty-state">
          A browser-accessible page (live console feed + RCON command box, one server at a time) - the same
          content as the Console &amp; RCON tab, reachable from a normal web browser instead of only from inside
          this app. It has no login of its own, so anything that can reach it has full RCON/admin control of
          your servers.
        </p>
        <p className="empty-state">
          <strong>Host</strong> controls who can reach it. Leave at <code>127.0.0.1</code> (default) to keep it
          reachable from this machine only. Set it to <code>0.0.0.0</code> to accept connections on every network
          interface, or to one specific local IP below to accept connections on just that one - either way, that
          means anyone on your local network can reach it, unauthenticated, so only do this on a network you
          trust.
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
        {isLan && (
          <p className="error-message">
            Web dashboard host is set to {settings.webDashboardHost} - reachable from other devices on your
            network with no login required.
          </p>
        )}
        <p className="empty-state">Save this form to apply a change immediately, no restart needed.</p>
        {settings.webDashboardEnabled && (
          <p className={webDashboardStatus.error ? 'error-message' : 'empty-state'}>
            {webDashboardStatus.error
              ? `Failed to start: ${webDashboardStatus.error}`
              : webDashboardStatus.running
                ? `Running at http://${webDashboardStatus.host}:${settings.webDashboardPort}`
                : 'Not running yet - save to start it.'}
          </p>
        )}

        <div className="form-actions">
          <button type="submit">Save</button>
          {status && <span className="status-message">{status}</span>}
        </div>
      </form>

      <section className="managed-steamcmd">
        <h3>Manager updates</h3>
        <p className="empty-state">
          Current version: <code>{appVersion || '...'}</code>. Checks this app&apos;s GitHub Releases for a newer
          version, downloads it, and installs it - the Manager quits and restarts on the new version once the
          download finishes. Only works in an installed/packaged build, not when running from source.
        </p>
        {appUpdateStatus.state !== 'idle' && (
          <p className={appUpdateStatus.state === 'error' ? 'error-message' : 'empty-state'}>
            {describeAppUpdateStatus(appUpdateStatus, appVersion)}
          </p>
        )}
        <button onClick={() => void window.api.appUpdate.checkAndInstall()} disabled={appUpdateBusy}>
          {appUpdateBusy ? 'Working...' : 'Check for updates'}
        </button>
      </section>
    </div>
  )
}
