import { useEffect, useState } from 'react'
import type { AppSettings, AppUpdateStatus } from '@shared/types'
import AccountsSection from './AccountsSection'
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
    iniLockEnabled: true
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

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.iniLockEnabled}
            onChange={(e) => setSettings({ ...settings, iniLockEnabled: e.target.checked })}
          />
          Lock config files while a server is running
        </label>
        <p className="empty-state">
          Sets <code>GameUserSettings.ini</code>/<code>Game.ini</code> read-only a few seconds after a server
          starts, and writable again a few seconds after it fully stops - a deterrent against editing a running
          server&apos;s config by accident (see the Analytics tab). Turning this off unlocks every server&apos;s
          config files right away, including ones currently running. Save this form to apply the change
          immediately.
        </p>

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
          Applies to every profile with &quot;Start this server when the Manager starts&quot; enabled (Server
          Management tab) - including the first one, so the Manager's own monitoring has time to finish
          initializing before that server starts and its telemetry is picked up correctly from the start. If
          several servers have it enabled, each subsequent one waits this same delay after the previous one.
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
          this app.
        </p>
        <p className="empty-state">
          <strong>Host</strong> controls who can reach it. Leave at <code>127.0.0.1</code> (default) to keep it
          reachable from this machine only. Set it to <code>0.0.0.0</code> to accept connections on every network
          interface, or to one specific local IP below to accept connections on just that one - either way, that
          means anyone on your local network can reach it, so only do this on a network you trust unless
          &quot;Require login&quot; below is also on.
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
            Web dashboard host is set to {settings.webDashboardHost} - reachable from other devices on your
            network with no login required.
          </p>
        )}

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.webDashboardAuthEnabled}
            onChange={(e) => setSettings({ ...settings, webDashboardAuthEnabled: e.target.checked })}
            disabled={!settings.webDashboardEnabled}
          />
          Require login (HTTPS)
        </label>
        <p className="empty-state">
          Switches the dashboard to <code>https://</code> with a self-signed certificate (browsers will show a
          &quot;not trusted&quot; warning the first time - that&apos;s expected, click through or install the
          certificate from <code>{defaultDataDir || 'the data folder'}/certs/cert.pem</code> if you want to avoid
          it) and requires logging in with one of the accounts below for every page and action. This is what makes
          it reasonably safe to expose outside your LAN (e.g. via router port forwarding) - without it, anyone who
          can reach the address has full unauthenticated control. Sessions don&apos;t survive a Manager restart or
          the dashboard being turned off and back on - everyone has to log in again.
        </p>
        <p className="empty-state">Save this form to apply a change immediately, no restart needed.</p>
        {settings.webDashboardEnabled && (
          <p className={webDashboardStatus.error ? 'error-message' : 'empty-state'}>
            {webDashboardStatus.error
              ? `Failed to start: ${webDashboardStatus.error}`
              : webDashboardStatus.running
                ? `Running at ${settings.webDashboardAuthEnabled ? 'https' : 'http'}://${webDashboardStatus.host}:${settings.webDashboardPort}`
                : 'Not running yet - save to start it.'}
          </p>
        )}

        <div className="form-actions">
          <button type="submit">Save</button>
          {status && <span className="status-message">{status}</span>}
        </div>
      </form>

      <AccountsSection />
      <ApiKeysSection />

      <section className="managed-steamcmd">
        <h3>Manager updates</h3>
        <p className="empty-state">
          Current version: <code>{appVersion || '...'}</code>. Checks this app&apos;s GitHub Releases for a newer
          version and downloads it - installing it (which restarts the Manager) is a separate step below, so it
          never restarts on its own out from under unsaved changes elsewhere in the app. Only works in an
          installed/packaged build, not when running from source.
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
  )
}
