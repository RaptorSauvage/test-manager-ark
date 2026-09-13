import { useState } from 'react'
import type { ServerProfile } from '@shared/types'
import ScheduleDaysPicker from './ScheduleDaysPicker'

interface ServerManagementTabProps {
  profile: ServerProfile
  onProfileChange: (profile: ServerProfile) => void
}

export default function ServerManagementTab({ profile, onProfileChange }: ServerManagementTabProps): JSX.Element {
  const [form, setForm] = useState<ServerProfile>(profile)
  const [error, setError] = useState('')

  async function persist(next: ServerProfile): Promise<void> {
    setError('')
    try {
      const updated = await window.api.profiles.save(next)
      const saved = updated.find((p) => p.id === next.id)
      if (saved) onProfileChange(saved)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function update<K extends keyof ServerProfile>(key: K, value: ServerProfile[K]): void {
    const next = { ...form, [key]: value }
    setForm(next)
    void persist(next)
  }

  return (
    <div className="server-management-tab">
      <section className="schedule-section">
        <h3>Manager Startup</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.startOnManagerLaunch}
            onChange={(e) => update('startOnManagerLaunch', e.target.checked)}
          />
          Start this server when the Manager starts
        </label>
        <p className="empty-state">
          Applies when the Manager application itself launches - not when Windows starts (see the &quot;Start
          Manager when you log into Windows&quot; option in Settings for that). Skipped if the server is already
          running (e.g. re-adopted from a previous Manager session). Waits for the delay configured in Settings
          before starting - even if it's the only one - so the Manager's own monitoring has time to finish
          initializing first and picks up this server's telemetry correctly from the start. If several servers
          have this enabled, they start one after another, each waiting that same delay after the previous one.
        </p>
      </section>

      <section className="schedule-section">
        <h3>Anti-Crash Watchdog</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.crashWatchEnabled}
            onChange={(e) => update('crashWatchEnabled', e.target.checked)}
          />
          Automatically restart this server if it crashes unexpectedly
        </label>
        <p className="empty-state">
          Only reacts to a confirmed, unexpected crash - one where the server was running and
          then simply vanished, with no sign of it being reachable at all anymore. Restarts
          15 seconds after detection. Stop, Kill, Restart, Update, and the scheduled restart
          below are never treated as a crash, since each of those already tells the Manager
          it's deliberate before it happens. Independent from every other server.
        </p>
      </section>

      <section className="schedule-section">
        <h3>Zombie Detection</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.zombieDetectionEnabled}
            onChange={(e) => update('zombieDetectionEnabled', e.target.checked)}
          />
          Kill this server if it gets stuck starting up
        </label>
        <div className="schedule-suboptions">
          <label>
            Timeout (minutes)
            <input
              type="number"
              min={1}
              value={form.zombieDetectionTimeoutMinutes}
              onChange={(e) => update('zombieDetectionTimeoutMinutes', Number(e.target.value))}
              disabled={!form.zombieDetectionEnabled}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.zombieDetectionAutoRestart}
              onChange={(e) => update('zombieDetectionAutoRestart', e.target.checked)}
              disabled={!form.zombieDetectionEnabled}
            />
            Restart automatically after killing it
          </label>
        </div>
        <p className="empty-state">
          Only watches the window between the process spawning (Starting) and the Manager
          confirming it actually finished loading (Running) - once Running, this has no
          effect until the next time the server starts. If it's still stuck Starting after
          the timeout above, it's killed as a zombie caught in an endless startup loop.
          Independent from every other server.
        </p>
      </section>

      <section className="schedule-section">
        <h3>Cluster Console Log Archive</h3>
        <label>
          Max archive size (MB)
          <input
            type="number"
            min={1}
            value={form.clusterLogArchiveMaxSizeMB}
            onChange={(e) => update('clusterLogArchiveMaxSizeMB', Number(e.target.value))}
          />
        </label>
        <p className="empty-state">
          Always on - this server's log events are continuously copied into a permanent
          archive file, separate from ARK's own ShooterGame.log (which a server restart
          resets). The Cluster Data group console's backlog reads from this archive once it
          exists, so it can show history from before the server's last restart. The oldest
          content is trimmed automatically once the archive passes the size above - it's a
          rolling window, not a hard stop on further logging.
        </p>
      </section>

      <section className="schedule-section">
        <h3>Advanced Schedule: Server Shutdown, Update, and Startup</h3>
        <ScheduleDaysPicker
          label="Shutdown server at:"
          countdownLabel="Next shutdown in:"
          enabled={form.scheduledRestartEnabled}
          onEnabledChange={(value) => update('scheduledRestartEnabled', value)}
          time={form.scheduledRestartTime}
          onTimeChange={(value) => update('scheduledRestartTime', value)}
          days={form.scheduledRestartDays}
          onDaysChange={(days) => update('scheduledRestartDays', days)}
        >
          <div className="schedule-suboptions">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.scheduledRestartUpdateAfter}
                onChange={(e) => update('scheduledRestartUpdateAfter', e.target.checked)}
                disabled={!form.scheduledRestartEnabled}
              />
              Update server from steam after shutdown
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.scheduledRestartStartAfter}
                onChange={(e) => update('scheduledRestartStartAfter', e.target.checked)}
                disabled={!form.scheduledRestartEnabled}
              />
              Start server after shutdown
            </label>
          </div>
        </ScheduleDaysPicker>
      </section>

      <section className="schedule-section">
        <h3>Advanced Schedule: Dino Wipe</h3>
        <ScheduleDaysPicker
          label="Wipe wild dinos at:"
          countdownLabel="Next dinowipe in:"
          enabled={form.scheduledDinoWipeEnabled}
          onEnabledChange={(value) => update('scheduledDinoWipeEnabled', value)}
          time={form.scheduledDinoWipeTime}
          onTimeChange={(value) => update('scheduledDinoWipeTime', value)}
          days={form.scheduledDinoWipeDays}
          onDaysChange={(days) => update('scheduledDinoWipeDays', days)}
        />
        <p className="empty-state">
          Sends the RCON command <code>DestroyWildDinos</code> at the scheduled time, independent of the
          shutdown schedule above. Only fires while the server is running.
        </p>
      </section>

      {error && <p className="error-message">{error}</p>}
    </div>
  )
}
