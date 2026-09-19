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
        <h3>Startup &amp; Watchdog</h3>
        <div className="schedule-subsection">
          <h4>Manager Startup</h4>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.startOnManagerLaunch}
              onChange={(e) => update('startOnManagerLaunch', e.target.checked)}
            />
            Start this server when the Manager starts
          </label>
          <p className="empty-state">Starts automatically when the Manager launches, unless already running.</p>
        </div>

        <div className="schedule-subsection">
          <h4>Anti-Crash Watchdog</h4>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.crashWatchEnabled}
              onChange={(e) => update('crashWatchEnabled', e.target.checked)}
            />
            Automatically restart this server if it crashes unexpectedly
          </label>
          <p className="empty-state">Restarts the server 15 seconds after a confirmed, unexpected crash.</p>
        </div>

        <div className="schedule-subsection">
          <h4>Zombie Detection</h4>
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
          <p className="empty-state">Kills the server if it's still stuck Starting past the timeout above.</p>
        </div>

        <div className="schedule-subsection">
          <h4>Cluster Console Log Archive</h4>
          <label>
            Max archive size (MB, 1-100)
            <input
              type="number"
              min={1}
              max={100}
              value={form.clusterLogArchiveMaxSizeMB}
              onChange={(e) => update('clusterLogArchiveMaxSizeMB', Math.min(100, Math.max(1, Number(e.target.value))))}
            />
          </label>
          <p className="empty-state">
            Always on - continuously archives this server's log events so cluster console history survives a
            restart.
          </p>
        </div>
      </section>

      <section className="schedule-section">
        <h3>Advanced Schedule: Restart</h3>
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
