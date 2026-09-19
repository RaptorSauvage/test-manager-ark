import { useEffect, useState } from 'react'
import type { MapDefinition, ServerProfile } from '@shared/types'

interface SettingsTabProps {
  profile: ServerProfile
  onProfileChange: (profile: ServerProfile) => void
}

export default function SettingsTab({ profile, onProfileChange }: SettingsTabProps): JSX.Element {
  const [form, setForm] = useState<ServerProfile>(profile)
  const [status, setStatus] = useState('')
  const [formError, setFormError] = useState('')
  const [maps, setMaps] = useState<MapDefinition[]>([])
  const [refreshingMaps, setRefreshingMaps] = useState(false)
  const [customMaps, setCustomMaps] = useState<MapDefinition[]>([])
  const [refreshingCustomMaps, setRefreshingCustomMaps] = useState(false)

  useEffect(() => {
    void refreshMaps()
    void refreshCustomMaps()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refreshMaps(): Promise<void> {
    setRefreshingMaps(true)
    try {
      setMaps(await window.api.maps.list())
    } finally {
      setRefreshingMaps(false)
    }
  }

  async function refreshCustomMaps(): Promise<void> {
    setRefreshingCustomMaps(true)
    try {
      setCustomMaps(await window.api.customMaps.list())
    } finally {
      setRefreshingCustomMaps(false)
    }
  }

  async function persist(next: ServerProfile): Promise<void> {
    const updated = await window.api.profiles.save(next)
    const saved = updated.find((p) => p.id === next.id)
    if (saved) onProfileChange(saved)
  }

  function update<K extends keyof ServerProfile>(key: K, value: ServerProfile[K]): void {
    const next = { ...form, [key]: value }
    setForm(next)
    void persist(next)
  }

  async function browseClusterDir(): Promise<void> {
    const dir = await window.api.dialog.selectDirectory()
    if (dir) update('clusterDirOverride', dir)
  }

  async function browseInstallDir(): Promise<void> {
    const dir = await window.api.dialog.selectDirectory()
    if (dir) update('installDir', dir)
  }

  async function openMapsFolder(): Promise<void> {
    setFormError('')
    try {
      await window.api.system.openDataDirFolder()
    } catch (err) {
      setFormError((err as Error).message)
    }
  }

  async function exportProfile(): Promise<void> {
    setFormError('')
    try {
      const filePath = await window.api.dialog.saveProfileFile(profile.name)
      if (!filePath) return
      await window.api.profiles.export(profile.id, filePath)
      setStatus('Exported')
      setTimeout(() => setStatus(''), 2000)
    } catch (err) {
      setFormError((err as Error).message)
    }
  }

  return (
    <form className="server-settings-tab" onSubmit={(e) => e.preventDefault()}>
      <section className="cluster-section">
        <h3>Server</h3>
        <label>
          Name
          <input value={form.name} onChange={(e) => update('name', e.target.value)} />
        </label>
        <label>
          Install directory
          <div className="path-input-row">
            <input
              value={form.installDir}
              onChange={(e) => update('installDir', e.target.value)}
              placeholder="C:\ARK\Server"
            />
            <button type="button" onClick={() => void browseInstallDir()}>
              Browse...
            </button>
          </div>
        </label>
        <div className="settings-grid">
          <label>
            Game port
            <input
              type="number"
              value={form.gamePort}
              onChange={(e) => update('gamePort', Number(e.target.value))}
            />
          </label>
          <label>
            RCON port
            <input
              type="number"
              value={form.rconPort}
              onChange={(e) => update('rconPort', Number(e.target.value))}
            />
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
        <div className="map-subgroup">
          <label>
            Map
            <div className="path-input-row">
              <select value={form.map} onChange={(e) => update('map', e.target.value)}>
                {form.map && !maps.some((m) => m.id === form.map) && !customMaps.some((m) => m.id === form.map) && (
                  <option value={form.map}>{form.map}</option>
                )}
                <optgroup label="Official">
                  {maps.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Custom">
                  {customMaps.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </optgroup>
              </select>
              <button
                type="button"
                onClick={() => void openMapsFolder()}
                title="Open the folder containing maps.json and customMaps.json"
              >
                Open Folder
              </button>
              <button
                type="button"
                onClick={() => {
                  void refreshMaps()
                  void refreshCustomMaps()
                }}
                disabled={refreshingMaps || refreshingCustomMaps}
                title="Reload maps.json and customMaps.json"
              >
                {refreshingMaps || refreshingCustomMaps ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </label>
          <label>
            Mod Map
            <div className="path-input-row">
              <input
                value={form.moddedMapId}
                onChange={(e) => update('moddedMapId', e.target.value)}
                placeholder="Workshop mod id"
                disabled={!form.moddedMapEnabled}
              />
              <button
                type="button"
                className={form.moddedMapEnabled ? 'active' : ''}
                onClick={() => update('moddedMapEnabled', !form.moddedMapEnabled)}
              >
                {form.moddedMapEnabled ? 'Modded Map Enabled' : 'Enable Modded Map'}
              </button>
            </div>
            <p className="empty-state">Passed as -MapModID=&lt;id&gt; when enabled, alongside the Map above.</p>
          </label>
        </div>
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
        <label>
          Dashboard group
          <input
            value={form.group}
            onChange={(e) => update('group', e.target.value)}
            placeholder="Leave blank for no group"
          />
        </label>
        <p className="empty-state">
          Every profile sharing the same group name collects into its own collapsible section on the dashboard,
          named after the group - handy for organizing a cluster or a set of test servers. Leave blank to show
          this server directly in the main grid.
        </p>
        <label>
          Extra launch arguments
          <input value={form.extraArgs} onChange={(e) => update('extraArgs', e.target.value)} />
        </label>
      </section>
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
      {formError && <p className="error-message">{formError}</p>}
      <div className="form-actions">
        <button type="button" onClick={() => void exportProfile()}>
          Export profile...
        </button>
        {status && <span className="status-message">{status}</span>}
      </div>
    </form>
  )
}
