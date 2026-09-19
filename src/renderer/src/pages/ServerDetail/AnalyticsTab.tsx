import { useEffect, useState } from 'react'
import type { BackupScheduleStatus, ServerProfile } from '@shared/types'
import { formatCountdown } from '@shared/scheduleTime'
import { useServerStatuses } from '../../lib/useServerStatuses'
import { STATS_TIME_SCALES, loadStoredScale, saveStoredScale, type StatSample } from '../../lib/sparkline'
import UpdateCheckPanel from '../../components/UpdateCheckPanel'
import ServerStatsChart from './ServerStatsChart'

/** How often the chart re-fetches this server's persisted history while the tab is open -
 *  independent of whatever cadence samples actually get recorded at (monitor.ts samples
 *  every 5s while statsEnabled is on), just how fresh the display stays. */
const STATS_POLL_INTERVAL_MS = 5000
/** How many points to ask for - plenty for a ~1000px-wide chart regardless of how much
 *  history the selected scale spans; the main process downsamples to this on read. */
const STATS_MAX_POINTS = 500

function statsScaleKey(profileId: string): string {
  return `analytics-stats-scale:${profileId}`
}

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

export default function AnalyticsTab({ profile, onProfileChange }: AnalyticsTabProps): JSX.Element {
  const statuses = useServerStatuses([profile.id])
  const status = statuses[profile.id]
  const [now, setNow] = useState(() => Date.now())
  const [buildId, setBuildId] = useState<string | null>(null)
  const [gameVersion, setGameVersion] = useState<string | null>(null)
  const [backupStatus, setBackupStatus] = useState<BackupScheduleStatus | null>(null)
  const [configFolderError, setConfigFolderError] = useState('')
  const [history, setHistory] = useState<StatSample[]>([])
  const [statsScale, setStatsScale] = useState(() => loadStoredScale(statsScaleKey(profile.id), STATS_TIME_SCALES[1].ms))
  const isRunning = status?.state === 'running'

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    setStatsScale(loadStoredScale(statsScaleKey(profile.id), STATS_TIME_SCALES[1].ms))
  }, [profile.id])

  // Polls this server's persisted history (src/main/lib/statsHistory.ts) rather than
  // accumulating samples client-side - the main process keeps recording independently of
  // whether this tab is even open, so switching tabs (or restarting the Manager) never
  // loses history the way the old localStorage-only version did.
  useEffect(() => {
    if (!profile.statsEnabled) {
      setHistory([])
      return
    }
    let cancelled = false
    function refresh(): void {
      window.api.statsHistory.get(profile.id, statsScale, STATS_MAX_POINTS).then((h) => {
        if (!cancelled) setHistory(h)
      })
    }
    refresh()
    const interval = setInterval(refresh, STATS_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [profile.id, profile.statsEnabled, statsScale])

  async function toggleStatsEnabled(): Promise<void> {
    const updated = await window.api.profiles.save({ ...profile, statsEnabled: !profile.statsEnabled })
    const saved = updated.find((p) => p.id === profile.id)
    if (saved) onProfileChange(saved)
  }

  function selectStatsScale(ms: number | null): void {
    setStatsScale(ms)
    saveStoredScale(statsScaleKey(profile.id), ms)
  }

  useEffect(() => {
    window.api.server.getInstalledBuildId(profile.id).then(setBuildId)
  }, [profile.id])

  useEffect(() => {
    let cancelled = false
    let interval: ReturnType<typeof setInterval> | undefined
    function refresh(): void {
      window.api.server.getGameVersion(profile.id).then((v) => {
        if (cancelled) return
        // Whatever's cached is shown even while stopped - it doesn't change between runs,
        // so there's no reason to blank it out just because the server isn't up right now.
        setGameVersion(v)
        if (v && interval) {
          // Found it - it won't change again for this run, so stop polling instead of
          // re-reading the log file every 5s for no reason.
          clearInterval(interval)
        }
      })
    }
    refresh()
    // Only keep polling while running - a stopped server's version won't newly appear on
    // its own, so a single read of whatever's cached is enough.
    if (isRunning) interval = setInterval(refresh, 5000)
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

  async function openFolder(opener: (profileId: string) => Promise<void>): Promise<void> {
    setConfigFolderError('')
    try {
      await opener(profile.id)
    } catch (err) {
      setConfigFolderError((err as Error).message)
    }
  }

  const uptimeMs = isRunning && status?.startedAt ? now - status.startedAt : null

  return (
    <div className="analytics-tab">
      <section className="cluster-section">
        <h3>Server Status</h3>
        <div className="server-status-layout">
          <div className="server-status-fields">
            <dl className="analytics-grid">
              <div>
                <dt>Server PID</dt>
                <dd>{status?.pid ?? '-'}</dd>
              </div>
              <div>
                <dt>Connected players</dt>
                <dd>
                  {status?.players?.length ?? 0} / {profile.maxPlayers}
                </dd>
              </div>
              <div>
                <dt>CPU usage</dt>
                <dd title={status?.statsError}>
                  {status?.cpu !== undefined ? `${status.cpu}%` : status?.statsError ? 'Unavailable' : '-'}
                </dd>
              </div>
              <div>
                <dt>Server Memory</dt>
                <dd title={status?.statsError}>
                  {status?.memoryMB !== undefined
                    ? `${status.memoryMB} MB${status.memoryPercent !== undefined ? ` (${status.memoryPercent}%)` : ''}`
                    : status?.statsError
                      ? 'Unavailable'
                      : '-'}
                </dd>
              </div>
              <div>
                <dt>Game Version</dt>
                <dd>
                  {gameVersion ?? (isRunning ? 'Detecting...' : 'Unknown')}
                  {buildId ? ` (${buildId})` : ''}
                </dd>
              </div>
              <div>
                <dt>Backup task status</dt>
                <dd
                  className={
                    !isRunning
                      ? 'status-offline'
                      : !profile.backupScheduleEnabled
                        ? 'status-warn'
                        : backupStatus?.active
                          ? 'status-ok'
                          : 'status-warn'
                  }
                >
                  {!isRunning
                    ? 'Offline'
                    : !profile.backupScheduleEnabled
                      ? 'Deactivate'
                      : backupStatus?.active
                        ? 'Started'
                        : 'Stopped'}
                </dd>
              </div>
              <div>
                <dt>Server uptime</dt>
                <dd>{uptimeMs !== null ? formatUptime(uptimeMs) : '-'}</dd>
              </div>
              {isRunning && profile.backupScheduleEnabled && backupStatus && (
                <div>
                  <dt>Next backup in</dt>
                  <dd>
                    {backupStatus.nextRunAt !== null ? formatCountdown(backupStatus.nextRunAt - now) : '--:--:--:--'}
                  </dd>
                </div>
              )}
            </dl>
            {!isRunning && (
              <p className="empty-state">Server isn&apos;t running - these will fill in once it starts.</p>
            )}
            {isRunning && status?.statsError && (
              <p className="error-message">CPU/RAM unavailable: {status.statsError}</p>
            )}
            <UpdateCheckPanel profileIds={[profile.id]} compact />
          </div>
          <div className="file-shortcuts">
            <span className="file-shortcuts-label">File Shortcuts</span>
            <button
              type="button"
              className="btn-sm"
              onClick={() => void openFolder(window.api.system.openServerConfigFolder)}
            >
              INI Config
            </button>
            <button
              type="button"
              className="btn-sm"
              onClick={() => void openFolder(window.api.system.openServerSavedArksFolder)}
            >
              Save ARKs
            </button>
            <button
              type="button"
              className="btn-sm"
              onClick={() => void openFolder(window.api.system.openServerSaveGamesFolder)}
            >
              Save Game
            </button>
            {configFolderError && <p className="error-message">{configFolderError}</p>}
          </div>
        </div>
      </section>

      <section className="cluster-section">
        <div className="stats-section-header">
          <h3>Server Statistics</h3>
          <div className="stats-controls">
            <label className="stats-toggle">
              <input type="checkbox" checked={profile.statsEnabled} onChange={() => void toggleStatsEnabled()} />
              Enable stats
            </label>
            {profile.statsEnabled && (
              <div className="time-scale-selector">
                <span>Time Scale</span>
                {STATS_TIME_SCALES.map((scale) => (
                  <button
                    key={scale.label}
                    type="button"
                    className={`time-scale-btn${scale.ms === statsScale ? ' active' : ''}`}
                    onClick={() => selectStatsScale(scale.ms)}
                  >
                    {scale.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {!profile.statsEnabled ? (
          <p className="empty-state">
            Stats collection is disabled for this server - enable it above to start recording CPU/RAM/player
            history persistently (survives Manager restarts, and keeps recording even while this tab isn&apos;t
            open).
          </p>
        ) : history.length > 0 ? (
          <ServerStatsChart
            history={history}
            maxPlayers={profile.maxPlayers}
            windowMs={statsScale ?? Math.max(1, now - history[0].time)}
            now={now}
          />
        ) : (
          <p className="empty-state">
            {isRunning ? 'Collecting data...' : "Server isn't running - start it to see live stats."}
          </p>
        )}
      </section>
    </div>
  )
}
