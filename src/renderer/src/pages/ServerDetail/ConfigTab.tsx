import { useEffect, useState } from 'react'
import type { ServerProfile, ServerConfigSummary, RawIniFiles } from '@shared/types'

interface ConfigTabProps {
  profile: ServerProfile
}

const DEFAULT_SUMMARY: ServerConfigSummary = {
  sessionName: '',
  serverPassword: '',
  serverAdminPassword: '',
  maxPlayers: 70,
  difficultyOffset: 1,
  xpMultiplier: 1,
  tamingSpeedMultiplier: 1,
  harvestAmountMultiplier: 1,
  pve: false
}

export default function ConfigTab({ profile }: ConfigTabProps): JSX.Element {
  const [summary, setSummary] = useState<ServerConfigSummary>(DEFAULT_SUMMARY)
  const [raw, setRaw] = useState<RawIniFiles | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    window.api.config.read(profile.id).then(setSummary)
    setShowRaw(false)
    setRaw(null)
    setError('')
  }, [profile.id])

  function flashStatus(message: string): void {
    setStatus(message)
    setTimeout(() => setStatus(''), 2000)
  }

  async function loadRaw(): Promise<void> {
    setError('')
    try {
      const files = await window.api.config.readRaw(profile.id)
      setRaw(files)
      setShowRaw(true)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function saveSummary(): Promise<void> {
    setError('')
    try {
      await window.api.config.writeSummary(profile.id, summary)
      flashStatus('Saved GameUserSettings.ini')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function saveRaw(): Promise<void> {
    if (!raw) return
    setError('')
    try {
      await window.api.config.writeRaw(profile.id, raw)
      flashStatus('Saved raw ini files')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function updateField<K extends keyof ServerConfigSummary>(key: K, value: ServerConfigSummary[K]): void {
    setSummary((prev) => ({ ...prev, [key]: value }))
  }

  if (showRaw && raw) {
    return (
      <div className="raw-editor">
        <label>
          GameUserSettings.ini
          <textarea
            rows={16}
            value={raw.gameUserSettings}
            onChange={(e) => setRaw({ ...raw, gameUserSettings: e.target.value })}
          />
        </label>
        <label>
          Game.ini
          <textarea rows={16} value={raw.game} onChange={(e) => setRaw({ ...raw, game: e.target.value })} />
        </label>
        {error && <p className="error-message">{error}</p>}
        <div className="form-actions">
          <button onClick={() => void saveRaw()}>Save raw files</button>
          <button onClick={() => setShowRaw(false)}>Back to form</button>
          {status && <span className="status-message">{status}</span>}
        </div>
      </div>
    )
  }

  return (
    <form
      className="config-form"
      onSubmit={(e) => {
        e.preventDefault()
        void saveSummary()
      }}
    >
      <label>
        Session name
        <input value={summary.sessionName} onChange={(e) => updateField('sessionName', e.target.value)} />
      </label>
      <label>
        Server password
        <input value={summary.serverPassword} onChange={(e) => updateField('serverPassword', e.target.value)} />
      </label>
      <label>
        Admin password
        <input
          value={summary.serverAdminPassword}
          onChange={(e) => updateField('serverAdminPassword', e.target.value)}
        />
      </label>
      <label>
        Max players
        <input
          type="number"
          value={summary.maxPlayers}
          onChange={(e) => updateField('maxPlayers', Number(e.target.value))}
        />
      </label>
      <label>
        Difficulty offset
        <input
          type="number"
          step="0.1"
          value={summary.difficultyOffset}
          onChange={(e) => updateField('difficultyOffset', Number(e.target.value))}
        />
      </label>
      <label>
        XP multiplier
        <input
          type="number"
          step="0.1"
          value={summary.xpMultiplier}
          onChange={(e) => updateField('xpMultiplier', Number(e.target.value))}
        />
      </label>
      <label>
        Taming speed multiplier
        <input
          type="number"
          step="0.1"
          value={summary.tamingSpeedMultiplier}
          onChange={(e) => updateField('tamingSpeedMultiplier', Number(e.target.value))}
        />
      </label>
      <label>
        Harvest amount multiplier
        <input
          type="number"
          step="0.1"
          value={summary.harvestAmountMultiplier}
          onChange={(e) => updateField('harvestAmountMultiplier', Number(e.target.value))}
        />
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={summary.pve} onChange={(e) => updateField('pve', e.target.checked)} />
        PvE server
      </label>
      {error && <p className="error-message">{error}</p>}
      <div className="form-actions">
        <button type="submit">Save</button>
        <button type="button" onClick={() => void loadRaw()}>
          Edit raw .ini files
        </button>
        {status && <span className="status-message">{status}</span>}
      </div>
    </form>
  )
}
