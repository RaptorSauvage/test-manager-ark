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
          running (e.g. re-adopted from a previous Manager session). If several servers have this enabled, they
          start one after another with a delay in between, configurable in Settings.
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
