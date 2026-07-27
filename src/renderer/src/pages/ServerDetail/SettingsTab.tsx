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

  async function browseClusterDir(): Promise<void> {
    const dir = await window.api.dialog.selectDirectory()
    if (dir) update('clusterDirOverride', dir)
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
          RCON port
          <input type="number" value={form.rconPort} onChange={(e) => update('rconPort', Number(e.target.value))} />
        </label>
        <label>
          Server Platform
          <select
            value={form.serverPlatform}
            onChange={(e) => update('serverPlatform', e.target.value as ServerProfile['serverPlatform'])}
          >
            <option value="PC">PC</option>
            <option value="ALL">ALL</option>
          </select>
        </label>
        <label>
          Max Players
          <input
            type="number"
            value={form.maxPlayers}
            onChange={(e) => update('maxPlayers', Number(e.target.value))}
          />
        </label>
      </div>
      <section className="cluster-section">
        <h3>Cluster</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.clusterEnabled}
            onChange={(e) => update('clusterEnabled', e.target.checked)}
          />
          Enable cluster
        </label>
        <label>
          Cluster ID
          <input
            value={form.clusterId}
            onChange={(e) => update('clusterId', e.target.value)}
            placeholder="my-cluster"
            disabled={!form.clusterEnabled}
          />
        </label>
        <label>
          Dedicated Cluster Directory
          <div className="path-input-row">
            <input
              value={form.clusterDirOverride}
              onChange={(e) => update('clusterDirOverride', e.target.value)}
              disabled={!form.clusterEnabled}
            />
            <button type="button" onClick={() => void browseClusterDir()} disabled={!form.clusterEnabled}>
              Browse...
            </button>
          </div>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.noTransferFromFiltering}
            onChange={(e) => update('noTransferFromFiltering', e.target.checked)}
            disabled={!form.clusterEnabled}
          />
          No Transfer From Filtering
        </label>
        <label>
          External IP
          <input
            value={form.externalIp}
            onChange={(e) => update('externalIp', e.target.value)}
            placeholder="203.0.113.10"
            disabled={!form.clusterEnabled}
          />
        </label>
      </section>
      <section className="cluster-section">
        <h3>Extra Settings</h3>
        <label className="checkbox">
          <input type="checkbox" checked disabled />
          RCON Enabled
        </label>
        <p className="empty-state">
          Always on - the Manager needs RCON for Stop/Restart and the RCON tab.
        </p>
        <label>
          Culture Settings
          <select
            value={form.cultureSettings}
            onChange={(e) => update('cultureSettings', e.target.value as ServerProfile['cultureSettings'])}
          >
            <option value="none">None</option>
            <option value="en">English</option>
            <option value="fr">French</option>
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.disableBattlEye}
            onChange={(e) => update('disableBattlEye', e.target.checked)}
          />
          Disable BattlEye
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.rconTribeLog}
            onChange={(e) => update('rconTribeLog', e.target.checked)}
          />
          RCON Tribe Log
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.forceRespawnDinos}
            onChange={(e) => update('forceRespawnDinos', e.target.checked)}
          />
          Force Respawn Wild Dinos
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={form.noSound} onChange={(e) => update('noSound', e.target.checked)} />
          No Sound
        </label>
      </section>
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
