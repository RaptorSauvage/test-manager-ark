import { useState } from 'react'
import type { MinecraftLaunchMode, MinecraftProfile } from '@shared/minecraft'

interface SettingsTabProps {
  profile: MinecraftProfile
  onProfileChange: (profile: MinecraftProfile) => void
}

export default function SettingsTab({ profile, onProfileChange }: SettingsTabProps): JSX.Element {
  const [form, setForm] = useState<MinecraftProfile>(profile)
  const [formError, setFormError] = useState('')
  const [redetecting, setRedetecting] = useState(false)

  async function persist(next: MinecraftProfile): Promise<void> {
    const updated = await window.api.minecraft.profiles.save(next)
    const saved = updated.find((p) => p.id === next.id)
    if (saved) onProfileChange(saved)
  }

  function update<K extends keyof MinecraftProfile>(key: K, value: MinecraftProfile[K]): void {
    const next = { ...form, [key]: value }
    setForm(next)
    void persist(next)
  }

  async function browseInstallDir(): Promise<void> {
    const dir = await window.api.dialog.selectDirectory()
    if (dir) update('installDir', dir)
  }

  async function redetectLaunchable(): Promise<void> {
    if (!form.installDir) return
    setFormError('')
    setRedetecting(true)
    try {
      const detected = await window.api.minecraft.detectLaunchable(form.installDir)
      if (!detected) {
        setFormError('No jar or launch script (run.bat/run.sh/start.bat/start.sh) found directly in that folder.')
        return
      }
      const next = {
        ...form,
        launchMode: detected.launchMode,
        jarFileName: detected.jarFileName,
        scriptFileName: detected.scriptFileName
      }
      setForm(next)
      void persist(next)
    } catch (err) {
      setFormError((err as Error).message)
    } finally {
      setRedetecting(false)
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
              placeholder="C:\Minecraft\Server"
            />
            <button type="button" onClick={() => void browseInstallDir()}>
              Browse...
            </button>
          </div>
        </label>
        <p className="empty-state">
          server.properties (port, RCON, motd, max players, ...) and eula.txt live in this folder and are read
          directly from there - edit them yourself, or via whatever tool you already use, the same as before this
          server was imported.
        </p>
      </section>

      <section className="cluster-section">
        <h3>Launch</h3>
        <label>
          Launch mode
          <select value={form.launchMode} onChange={(e) => update('launchMode', e.target.value as MinecraftLaunchMode)}>
            <option value="jar">Jar (vanilla / Fabric / Paper / Spigot)</option>
            <option value="script">Launch script (modern Forge, or your own custom start script)</option>
          </select>
        </label>
        {form.launchMode === 'jar' ? (
          <label>
            Jar file name
            <input
              value={form.jarFileName}
              onChange={(e) => update('jarFileName', e.target.value)}
              placeholder="server.jar"
            />
          </label>
        ) : (
          <label>
            Script file name
            <input
              value={form.scriptFileName}
              onChange={(e) => update('scriptFileName', e.target.value)}
              placeholder="run.bat"
            />
          </label>
        )}
        <button type="button" onClick={() => void redetectLaunchable()} disabled={redetecting || !form.installDir}>
          {redetecting ? 'Detecting...' : 'Re-detect from install directory'}
        </button>
        {formError && <p className="error-message">{formError}</p>}

        <div className="settings-grid">
          <label>
            Min memory (MB)
            <input
              type="number"
              value={form.minMemoryMB}
              onChange={(e) => update('minMemoryMB', Number(e.target.value))}
              disabled={form.launchMode === 'script'}
            />
          </label>
          <label>
            Max memory (MB)
            <input
              type="number"
              value={form.maxMemoryMB}
              onChange={(e) => update('maxMemoryMB', Number(e.target.value))}
              disabled={form.launchMode === 'script'}
            />
          </label>
        </div>
        {form.launchMode === 'script' && (
          <p className="empty-state">
            Memory is controlled by the script itself in launch mode &quot;script&quot; - these fields are ignored.
          </p>
        )}
        <label>
          Extra JVM arguments
          <input
            value={form.extraJvmArgs}
            onChange={(e) => update('extraJvmArgs', e.target.value)}
            placeholder="-XX:+UseG1GC"
            disabled={form.launchMode === 'script'}
          />
        </label>
        <label>
          Extra program arguments
          <input
            value={form.extraProgramArgs}
            onChange={(e) => update('extraProgramArgs', e.target.value)}
            placeholder="nogui"
          />
        </label>
      </section>

      <section className="cluster-section">
        <h3>Extra Settings</h3>
        <label>
          Dashboard group
          <input value={form.group} onChange={(e) => update('group', e.target.value)} placeholder="(none)" />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.startOnManagerLaunch}
            onChange={(e) => update('startOnManagerLaunch', e.target.checked)}
          />
          Start automatically when the Manager launches
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={form.hidden} onChange={(e) => update('hidden', e.target.checked)} />
          Hide from the main dashboard
        </label>
      </section>
    </form>
  )
}
