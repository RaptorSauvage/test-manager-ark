import { useState } from 'react'
import type { MinecraftProfile } from '@shared/minecraft'
import ScheduleDaysPicker from '../ServerDetail/ScheduleDaysPicker'

interface ServerManagementTabProps {
  profile: MinecraftProfile
  onProfileChange: (profile: MinecraftProfile) => void
}

export default function ServerManagementTab({ profile, onProfileChange }: ServerManagementTabProps): JSX.Element {
  const [form, setForm] = useState<MinecraftProfile>(profile)
  const [error, setError] = useState('')

  async function persist(next: MinecraftProfile): Promise<void> {
    setError('')
    try {
      const updated = await window.api.minecraft.profiles.save(next)
      const saved = updated.find((p) => p.id === next.id)
      if (saved) onProfileChange(saved)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function update<K extends keyof MinecraftProfile>(key: K, value: MinecraftProfile[K]): void {
    const next = { ...form, [key]: value }
    setForm(next)
    void persist(next)
  }

  return (
    <div className="server-management-tab">
      <section className="schedule-section">
        <h3>Startup</h3>
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
      </section>

      <section className="schedule-section">
        <h3>Advanced Schedule</h3>
        <div className="schedule-subsection">
          <h4>Restart</h4>
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
                  checked={form.scheduledRestartStartAfter}
                  onChange={(e) => update('scheduledRestartStartAfter', e.target.checked)}
                  disabled={!form.scheduledRestartEnabled}
                />
                Start server after shutdown
              </label>
            </div>
          </ScheduleDaysPicker>
          <p className="empty-state">
            Sends the server&apos;s own graceful stop (same as the Stop button) at the scheduled time, then starts it
            back up unless &quot;Start server after shutdown&quot; is unchecked - useful for a plain scheduled
            shutdown with no restart.
          </p>
        </div>
      </section>

      {error && <p className="error-message">{error}</p>}
    </div>
  )
}
