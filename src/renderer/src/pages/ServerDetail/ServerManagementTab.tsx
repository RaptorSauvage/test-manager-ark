import { useState } from 'react'
import type { ServerProfile } from '@shared/types'
import ScheduleDaysPicker from './ScheduleDaysPicker'

interface ServerManagementTabProps {
  profile: ServerProfile
  onProfileChange: (profile: ServerProfile) => void
}

export default function ServerManagementTab({ profile, onProfileChange }: ServerManagementTabProps): JSX.Element {
  const [form, setForm] = useState<ServerProfile>(profile)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  function update<K extends keyof ServerProfile>(key: K, value: ServerProfile[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function save(): Promise<void> {
    setError('')
    try {
      const updated = await window.api.profiles.save(form)
      const saved = updated.find((p) => p.id === form.id)
      if (saved) onProfileChange(saved)
      setStatus('Saved')
      setTimeout(() => setStatus(''), 2000)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="server-management-tab">
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
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.scheduledRestartDestroyWildDinosAfter}
                onChange={(e) => update('scheduledRestartDestroyWildDinosAfter', e.target.checked)}
                disabled={!form.scheduledRestartEnabled || !form.scheduledRestartStartAfter}
              />
              Destroy WildDino After Start
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
      <div className="form-actions">
        <button onClick={() => void save()}>Save server management settings</button>
        {status && <span className="status-message">{status}</span>}
      </div>
    </div>
  )
}
