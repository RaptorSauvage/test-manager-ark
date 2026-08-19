import { useEffect, useRef, useState } from 'react'
import type { BackupScheduleStatus, ServerProfile, ServerStatus } from '@shared/types'
import { formatCountdown } from '@shared/scheduleTime'
import { useServerStatuses } from '../../lib/useServerStatuses'
import { appendSample, selectHistoryWindow, type StatSample } from '../../lib/sparkline'
import UpdateCheckPanel from '../../components/UpdateCheckPanel'
import ServerStatsChart from './ServerStatsChart'

/** How much history the Server Statistics chart collects, regardless of what time scale is
 *  currently selected for display. */
const STATS_HISTORY_WINDOW_MS = 60 * 60 * 1000
/** How often a new point is sampled - independent of whatever cadence status pushes
 *  actually arrive at, so the chart has a steady, predictable rhythm. */
const STATS_SAMPLE_INTERVAL_MS = 5000
/** Time scale choices for the Server Statistics chart, matching the collected window (1h max). */
const STATS_TIME_SCALES: Array<{ label: string; ms: number }> = [
  { label: '1m', ms: 60 * 1000 },
  { label: '5m', ms: 5 * 60 * 1000 },
  { label: '30m', ms: 30 * 60 * 1000 },
  { label: '1h', ms: 60 * 60 * 1000 }
]

function statsEnabledKey(profileId: string): string {
  return `analytics-stats-enabled:${profileId}`
}

function statsHistoryKey(profileId: string): string {
  return `analytics-stats-history:${profileId}`
}

function statsScaleKey(profileId: string): string {
  return `analytics-stats-scale:${profileId}`
}

/** Falls back to the default (5m) scale if nothing's stored yet, or if what's stored no
 *  longer matches one of the selectable time scales. */
function loadStoredScale(profileId: string): number {
  const raw = localStorage.getItem(statsScaleKey(profileId))
  const parsed = raw !== null ? Number(raw) : NaN
  return STATS_TIME_SCALES.some((scale) => scale.ms === parsed) ? parsed : STATS_TIME_SCALES[1].ms
}

/** Reloads whatever history was collected before the tab/page was last torn down, trimmed to
 *  the current collection window - so reopening Analytics (or reloading the app) picks up
 *  where it left off instead of starting from an empty chart every time. */
function loadStoredHistory(profileId: string): StatSample[] {
  try {
    const raw = localStorage.getItem(statsHistoryKey(profileId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return selectHistoryWindow(parsed as StatSample[], STATS_HISTORY_WINDOW_MS, Date.now())
  } catch {
    return []
  }
}

function saveStoredHistory(profileId: string, history: StatSample[]): void {
  localStorage.setItem(statsHistoryKey(profileId), JSON.stringify(history))
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

export default function AnalyticsTab({ profile }: AnalyticsTabProps): JSX.Element {
  const statuses = useServerStatuses([profile.id])
  const status = statuses[profile.id]
  const [now, setNow] = useState(() => Date.now())
  const [buildId, setBuildId] = useState<string | null>(null)
  const [gameVersion, setGameVersion] = useState<string | null>(null)
  const [backupStatus, setBackupStatus] = useState<BackupScheduleStatus | null>(null)
  const [configFolderError, setConfigFolderError] = useState('')
  const [history, setHistory] = useState<StatSample[]>(() => loadStoredHistory(profile.id))
  const [statsEnabled, setStatsEnabled] = useState(() => localStorage.getItem(statsEnabledKey(profile.id)) !== 'false')
  const [statsScale, setStatsScale] = useState(() => loadStoredScale(profile.id))
  const isRunning = status?.state === 'running'
  const statusRef = useRef<ServerStatus | undefined>(status)
  statusRef.current = status

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    setHistory(loadStoredHistory(profile.id))
    setStatsEnabled(localStorage.getItem(statsEnabledKey(profile.id)) !== 'false')
    setStatsScale(loadStoredScale(profile.id))
  }, [profile.id])

  useEffect(() => {
    if (!statsEnabled) return
    const interval = setInterval(() => {
      const s = statusRef.current
      if (!s || s.state !== 'running') return
      setHistory((prev) => {
        const next = appendSample(
          prev,
          { time: Date.now(), cpu: s.cpu ?? 0, memoryMB: s.memoryMB ?? 0, players: s.players?.length ?? 0 },
          STATS_HISTORY_WINDOW_MS
        )
        saveStoredHistory(profile.id, next)
        return next
      })
    }, STATS_SAMPLE_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [profile.id, statsEnabled])

  function toggleStatsEnabled(): void {
    const next = !statsEnabled
    setStatsEnabled(next)
    localStorage.setItem(statsEnabledKey(profile.id), String(next))
  }

  function selectStatsScale(ms: number): void {
    setStatsScale(ms)
    localStorage.setItem(statsScaleKey(profile.id), String(ms))
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
                <dd>{status?.cpu !== undefined ? `${status.cpu}%` : '-'}</dd>
              </div>
              <div>
                <dt>Server Memory</dt>
                <dd>
                  {status?.memoryMB !== undefined
                    ? `${status.memoryMB} MB${status.memoryPercent !== undefined ? ` (${status.memoryPercent}%)` : ''}`
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
              <input type="checkbox" checked={statsEnabled} onChange={toggleStatsEnabled} />
              Enable stats
            </label>
            {statsEnabled && (
              <div className="time-scale-selector">
                <span>Time Scale</span>
                {STATS_TIME_SCALES.map((scale) => (
                  <button
                    key={scale.ms}
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
        {!statsEnabled ? (
          <p className="empty-state">Stats collection is disabled for this server.</p>
        ) : history.length > 0 ? (
          <ServerStatsChart history={history} maxPlayers={profile.maxPlayers} windowMs={statsScale} now={now} />
        ) : (
          <p className="empty-state">
            {isRunning ? 'Collecting data...' : "Server isn't running - start it to see live stats."}
          </p>
        )}
      </section>
    </div>
  )
}
