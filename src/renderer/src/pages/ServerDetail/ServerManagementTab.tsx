import { useState } from 'react'
import type { ServerProfile, ScheduledRconCommand, ScheduledRconTriggerType, ScheduledRconPlayerRequirement } from '@shared/types'
import ScheduleDaysPicker from './ScheduleDaysPicker'

const TRIGGER_CARDS: Array<{ value: ScheduledRconTriggerType; label: string; description: string }> = [
  { value: 'fixedTime', label: 'Fixed Time', description: 'Run at a certain time' },
  { value: 'interval', label: 'Interval', description: 'Repeat every few seconds' },
  { value: 'timeless', label: 'Timeless', description: 'Manual only, via Run now' }
]

interface ServerManagementTabProps {
  profile: ServerProfile
  onProfileChange: (profile: ServerProfile) => void
}

export default function ServerManagementTab({ profile, onProfileChange }: ServerManagementTabProps): JSX.Element {
  const [form, setForm] = useState<ServerProfile>(profile)
  const [error, setError] = useState('')
  const [runningEntryId, setRunningEntryId] = useState<string | null>(null)
  const [runResults, setRunResults] = useState<Record<string, string>>({})

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

  function updateRconEntry(id: string, patch: Partial<ScheduledRconCommand>): void {
    update(
      'scheduledRconCommands',
      form.scheduledRconCommands.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
    )
  }

  function addRconEntry(): void {
    update('scheduledRconCommands', [
      ...form.scheduledRconCommands,
      {
        id: crypto.randomUUID(),
        label: '',
        command: '',
        triggerType: 'fixedTime',
        time: '00:00',
        days: [],
        intervalSeconds: 60,
        playerRequirement: 'always',
        enabled: false
      }
    ])
  }

  function removeRconEntry(id: string): void {
    update(
      'scheduledRconCommands',
      form.scheduledRconCommands.filter((entry) => entry.id !== id)
    )
  }

  // Bypasses the trigger and player-requirement checks entirely - clicking this is already
  // the user explicitly deciding to run it right now, not waiting for its schedule. A
  // 'timeless' entry has no other way to ever actually fire at all.
  async function runRconEntryNow(entry: ScheduledRconCommand): Promise<void> {
    if (!entry.command.trim()) return
    setRunningEntryId(entry.id)
    setRunResults((prev) => ({ ...prev, [entry.id]: '' }))
    try {
      const result = await window.api.groupConsole.sendRcon(form.id, entry.command)
      setRunResults((prev) => ({ ...prev, [entry.id]: result.ok ? 'Sent.' : `Failed: ${result.error}` }))
    } catch (err) {
      setRunResults((prev) => ({ ...prev, [entry.id]: `Failed: ${(err as Error).message}` }))
    } finally {
      setRunningEntryId(null)
    }
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
          <p className="empty-state">
            Kills the server if it's still stuck Starting past the timeout above.
            {form.game === 'ark-evolved' && (
              <>
                {' '}
                For ARK: Survival Evolved, it also keeps watching once the server is running: if its own log file
                (<code>ShooterGame.log</code>) goes completely quiet for the same timeout - not even the usual
                periodic engine/save activity a healthy server logs on its own - that&apos;s treated as a frozen
                world tick and killed the same way.
              </>
            )}
          </p>
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
                  checked={form.scheduledRestartOnlyIfEmpty}
                  onChange={(e) => update('scheduledRestartOnlyIfEmpty', e.target.checked)}
                  disabled={!form.scheduledRestartEnabled}
                />
                Only if no players are connected
              </label>
            </div>
            <p className="empty-state">
              When checked, a restart that comes due while anyone's still online is skipped entirely for that
              occurrence (nothing is stopped/updated/started) - it's tried again at the next scheduled occurrence
              instead of sooner.
            </p>
          </ScheduleDaysPicker>
        </div>

        <div className="schedule-subsection">
          <h4>Dino Wipe</h4>
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
        </div>

        <div className="schedule-subsection">
          <h4>Scheduled Maintenance (Stop → Backup → Update → Start)</h4>
          <ScheduleDaysPicker
            label="Run maintenance at:"
            countdownLabel="Next maintenance in:"
            enabled={form.scheduledMaintenanceEnabled}
            onEnabledChange={(value) => update('scheduledMaintenanceEnabled', value)}
            time={form.scheduledMaintenanceTime}
            onTimeChange={(value) => update('scheduledMaintenanceTime', value)}
            days={form.scheduledMaintenanceDays}
            onDaysChange={(days) => update('scheduledMaintenanceDays', days)}
          />
          <p className="empty-state">
            A single fixed pipeline, separate from the Restart schedule above: stops the server, takes a backup,
            updates it via SteamCMD, then starts it back up - every step runs regardless of the others&apos;
            outcome (e.g. a failed backup still lets the update and restart happen).
          </p>
        </div>
      </section>

      <section className="schedule-section">
        <h3>Scheduled RCON Commands</h3>
        <p className="empty-state">
          Runs any RCON command on its own trigger - independent of Restart/Dino Wipe/Maintenance above.
        </p>
        {form.scheduledRconCommands.map((entry) => (
          <div key={entry.id} className="rcon-entry">
            <div className="schedule-picker-row">
              <input
                placeholder="Label (optional)"
                value={entry.label}
                onChange={(e) => updateRconEntry(entry.id, { label: e.target.value })}
              />
              <input
                placeholder="RCON command, e.g. ServerChat Restart in 10 minutes"
                value={entry.command}
                onChange={(e) => updateRconEntry(entry.id, { command: e.target.value })}
              />
            </div>

            <div className="rcon-trigger-cards">
              {TRIGGER_CARDS.map((card) => (
                <button
                  key={card.value}
                  type="button"
                  className={'rcon-trigger-card' + (entry.triggerType === card.value ? ' active' : '')}
                  onClick={() => updateRconEntry(entry.id, { triggerType: card.value })}
                >
                  <strong>{card.label}</strong>
                  <span>{card.description}</span>
                </button>
              ))}
            </div>

            {entry.triggerType === 'fixedTime' && (
              <ScheduleDaysPicker
                label="Run at:"
                countdownLabel="Next run in:"
                enabled={entry.enabled}
                onEnabledChange={(value) => updateRconEntry(entry.id, { enabled: value })}
                time={entry.time}
                onTimeChange={(value) => updateRconEntry(entry.id, { time: value })}
                days={entry.days}
                onDaysChange={(days) => updateRconEntry(entry.id, { days })}
              />
            )}

            {entry.triggerType === 'interval' && (
              <div className="schedule-picker-row">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={entry.enabled}
                    onChange={(e) => updateRconEntry(entry.id, { enabled: e.target.checked })}
                  />
                  Enabled
                </label>
                <label>
                  Every (seconds)
                  <input
                    type="number"
                    min={1}
                    value={entry.intervalSeconds}
                    onChange={(e) => updateRconEntry(entry.id, { intervalSeconds: Math.max(1, Number(e.target.value)) })}
                    disabled={!entry.enabled}
                  />
                </label>
              </div>
            )}

            {entry.triggerType === 'timeless' && (
              <div className="schedule-picker-row">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={entry.enabled}
                    onChange={(e) => updateRconEntry(entry.id, { enabled: e.target.checked })}
                  />
                  Enabled
                </label>
                <p className="empty-state">No automatic schedule - use &quot;Run now&quot; below.</p>
              </div>
            )}

            <label>
              Player requirement
              <select
                value={entry.playerRequirement}
                onChange={(e) =>
                  updateRconEntry(entry.id, { playerRequirement: e.target.value as ScheduledRconPlayerRequirement })
                }
              >
                <option value="always">Always run, regardless of player count</option>
                <option value="onlyIfEmpty">Only run when server is empty</option>
                <option value="onlyIfPlayers">Only run when players are online</option>
              </select>
            </label>

            <div className="form-actions">
              <button
                type="button"
                onClick={() => void runRconEntryNow(entry)}
                disabled={!entry.command.trim() || runningEntryId === entry.id}
              >
                {runningEntryId === entry.id ? 'Running...' : 'Run now'}
              </button>
              <button type="button" className="btn-delete-backup" onClick={() => removeRconEntry(entry.id)}>
                Remove
              </button>
              {runResults[entry.id] && <span className="empty-state">{runResults[entry.id]}</span>}
            </div>
          </div>
        ))}
        <button type="button" onClick={addRconEntry}>
          Add scheduled command
        </button>
      </section>

      {error && <p className="error-message">{error}</p>}
    </div>
  )
}
