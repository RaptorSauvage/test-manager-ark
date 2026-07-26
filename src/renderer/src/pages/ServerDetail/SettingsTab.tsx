import { useState } from 'react'
import type { ServerProfile } from '@shared/types'

interface SettingsTabProps {
  profile: ServerProfile
  onProfileChange: (profile: ServerProfile) => void
}

export default function SettingsTab({ profile, onProfileChange }: SettingsTabProps): JSX.Element {
  const [form, setForm] = useState<ServerProfile>(profile)
  const [status, setStatus] = useState('')

  function update<K extends keyof ServerProfile>(key: K, value: ServerProfile[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function save(): Promise<void> {
    const updated = await window.api.profiles.save(form)
    const saved = updated.find((p) => p.id === form.id)
    if (saved) onProfileChange(saved)
    setStatus('Saved')
    setTimeout(() => setStatus(''), 2000)
  }

  return (
    <form
      className="settings-tab"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <label>
        Name
        <input value={form.name} onChange={(e) => update('name', e.target.value)} />
      </label>
      <label>
        Install directory
        <input
          value={form.installDir}
          onChange={(e) => update('installDir', e.target.value)}
          placeholder="C:\ARK\Server"
        />
      </label>
      <label>
        Map
        <input value={form.map} onChange={(e) => update('map', e.target.value)} placeholder="TheIsland_WP" />
      </label>
      <div className="settings-grid">
        <label>
          Game port
          <input type="number" value={form.gamePort} onChange={(e) => update('gamePort', Number(e.target.value))} />
        </label>
        <label>
          Query port
          <input
            type="number"
            value={form.queryPort}
            onChange={(e) => update('queryPort', Number(e.target.value))}
          />
        </label>
        <label>
          RCON port
          <input type="number" value={form.rconPort} onChange={(e) => update('rconPort', Number(e.target.value))} />
        </label>
      </div>
      <label>
        RCON / admin password
        <input type="password" value={form.rconPassword} onChange={(e) => update('rconPassword', e.target.value)} />
      </label>
      <label>
        SavedArks path (relative to install dir)
        <input value={form.savedArksSubPath} onChange={(e) => update('savedArksSubPath', e.target.value)} />
      </label>
      <label>
        Backup directory
        <input value={form.backupDir} onChange={(e) => update('backupDir', e.target.value)} />
      </label>
      <div className="settings-grid">
        <label>
          Max backups to keep
          <input
            type="number"
            value={form.maxBackups}
            onChange={(e) => update('maxBackups', Number(e.target.value))}
          />
        </label>
        <label>
          Backup schedule (cron, optional)
          <input
            value={form.backupSchedule ?? ''}
            onChange={(e) => update('backupSchedule', e.target.value)}
            placeholder="every 6 hours: 0 */6 * * *"
          />
        </label>
      </div>
      <label>
        Extra launch arguments
        <input value={form.extraArgs} onChange={(e) => update('extraArgs', e.target.value)} />
      </label>
      <div className="form-actions">
        <button type="submit">Save settings</button>
        {status && <span className="status-message">{status}</span>}
      </div>
    </form>
  )
}
