import { useEffect, useState } from 'react'
import type { BackupScheduleStatus, ServerProfile } from '@shared/types'
import { formatCountdown } from '@shared/scheduleTime'
import { useServerStatuses } from '../../lib/useServerStatuses'
import UpdateCheckPanel from '../../components/UpdateCheckPanel'

interface AnalyticsTabProps {
  profile: ServerProfile
  onProfileChange: (profile: ServerProfile) => void
}

function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const totalHours = Math.floor(totalMinutes / 60)
  const hours = totalHours % 24
  const days = Math.floor(totalHours / 24)
  return `${days}d ${hours}h ${minutes}m ${seconds}s`
}

export default function AnalyticsTab({ profile }: AnalyticsTabProps): JSX.Element {
  const statuses = useServerStatuses([profile.id])
  const status = statuses[profile.id]
  const [now, setNow] = useState(() => Date.now())
  const [buildId, setBuildId] = useState<string | null>(null)
  const [gameVersion, setGameVersion] = useState<string | null>(null)
  const [backupStatus, setBackupStatus] = useState<BackupScheduleStatus | null>(null)
  const [configFolderError, setConfigFolderError] = useState('')
  const isRunning = status?.state === 'running'

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    window.api.server.getInstalledBuildId(profile.id).then(setBuildId)
  }, [profile.id])

  useEffect(() => {
    if (!isRunning) {
      setGameVersion(null)
      return
    }
    let cancelled = false
    let interval: ReturnType<typeof setInterval> | undefined
    function refresh(): void {
      window.api.server.getGameVersion(profile.id).then((v) => {
        if (cancelled) return
        if (v) {
          // Found it - it won't change again for this run, so stop polling instead of
          // spawning PowerShell every 5s for no reason.
          setGameVersion(v)
          clearInterval(interval)
        }
      })
    }
    refresh()
    interval = setInterval(refresh, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [profile.id, isRunning])

  useEffect(() => {
    let cancelled = false
    function refresh(): void {
      window.api.backup.getScheduleStatus(profile.id).then((s) => {
        if (!cancelled) setBackupStatus(s)
      })
    }
    refresh()
    const interval = setInterval(refresh, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [profile.id])

  async function openConfigFolder(): Promise<void> {
    setConfigFolderError('')
    try {
      await window.api.system.openServerConfigFolder(profile.id)
    } catch (err) {
      setConfigFolderError((err as Error).message)
    }
  }

  const uptimeMs = isRunning && status?.startedAt ? now - status.startedAt : null

  return (
    <div className="analytics-tab">
      <section className="cluster-section">
        <h3>Server Status</h3>
        <dl className="analytics-grid">
          <div>
            <dt>Server PID</dt>
            <dd>{status?.pid ?? '-'}</dd>
          </div>
          <div>
            <dt>Server uptime</dt>
            <dd>{uptimeMs !== null ? formatUptime(uptimeMs) : '-'}</dd>
          </div>
          <div>
            <dt>Server memory in use</dt>
            <dd>
              {status?.memoryMB !== undefined
                ? `${status.memoryMB} MB${status.memoryPercent !== undefined ? ` (${status.memoryPercent}%)` : ''}`
                : '-'}
            </dd>
          </div>
          <div>
            <dt>Connected players</dt>
            <dd>
              {status?.players?.length ?? 0} / {profile.maxPlayers}
            </dd>
          </div>
        </dl>
        {!isRunning && <p className="empty-state">Server isn&apos;t running - these will fill in once it starts.</p>}
      </section>

      <section className="cluster-section">
        <h3>Version</h3>
        <dl className="analytics-grid">
          <div>
            <dt>Installed Build ID</dt>
            <dd>{buildId ?? 'Not installed yet'}</dd>
          </div>
          <div>
            <dt>Game Version</dt>
            <dd>{isRunning ? (gameVersion ?? 'Detecting...') : 'Server not running'}</dd>
          </div>
        </dl>
        {!buildId && (
          <p className="empty-state">
            No <code>appmanifest_2430930.acf</code> found under <code>{profile.installDir}\steamapps</code> -
            SteamCMD writes this the first time it installs/updates this server. If this install folder was set up
            by another tool or copied in manually without ever running an update through SteamCMD here, this stays
            empty even though the server itself runs fine - it only affects the Build ID/update-check display, not
            Start.
          </p>
        )}
        <p className="empty-state">
          <strong>Game Version</strong> (e.g. "92.28") is read live from the running server's own console window
          title on Windows - it takes a few seconds after start to appear, and stays empty on other platforms or
          if the server was launched some other way.
        </p>
      </section>

      <UpdateCheckPanel profileIds={[profile.id]} />

      <section className="cluster-section">
        <h3>Backup Status</h3>
        {!profile.backupScheduleEnabled && (
          <p className="empty-state">Backup schedule is disabled - enable it in the Backups tab.</p>
        )}
        {profile.backupScheduleEnabled && backupStatus && (
          <dl className="analytics-grid">
            <div>
              <dt>Backup task status</dt>
              <dd className={backupStatus.active ? 'status-ok' : 'status-warn'}>
                {backupStatus.active ? 'Started' : 'Stopped'}
              </dd>
            </div>
            <div>
              <dt>Next backup in</dt>
              <dd>{backupStatus.nextRunAt !== null ? formatCountdown(backupStatus.nextRunAt - now) : '--:--:--:--'}</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="cluster-section">
        <h3>Config Files</h3>
        <button type="button" onClick={() => void openConfigFolder()}>
          Open config folder
        </button>
        <p className="empty-state">
          Opens <code>ShooterGame/Saved/Config/WindowsServer</code> - where{' '}
          <code>GameUserSettings.ini</code>/<code>Game.ini</code> live. The app never edits these itself; open them
          in a text editor from there.
        </p>
        {configFolderError && <p className="error-message">{configFolderError}</p>}
      </section>
    </div>
  )
}
