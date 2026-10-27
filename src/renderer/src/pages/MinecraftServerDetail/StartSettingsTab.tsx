import { useEffect, useState } from 'react'
import type { MinecraftLaunchMode, MinecraftProfile, MinecraftServerType } from '@shared/minecraft'
import type { MinecraftInstallableType, MinecraftVersionOption } from '@shared/minecraftInstall'
import { supportsLoaderVersionSelection } from '@shared/minecraftInstall'
import { MINECRAFT_SERVER_TYPE_ICONS } from '../../lib/minecraftServerTypeIcons'

const SERVER_TYPE_OPTIONS: Array<{ value: MinecraftServerType; label: string }> = [
  { value: 'vanilla', label: 'Vanilla' },
  { value: 'paper', label: 'Paper' },
  { value: 'spigot', label: 'Spigot' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'forge', label: 'Forge' },
  { value: 'neoforge', label: 'NeoForge' },
  { value: 'spongevanilla', label: 'SpongeVanilla' },
  { value: 'spongeforge', label: 'SpongeForge' },
  { value: 'unknown', label: 'Unknown' }
]

/** Whether the Minecraft version/loader version pickers below can even be driven live - they
 *  need a real, installable loader type (window.api.minecraft.install.listVersions), which
 *  'unknown' (not a real loader at all) never has. A server with serverType 'unknown' instead
 *  falls back to a free-text version field, same as every server did before these pickers
 *  existed. */
function isInstallableType(serverType: MinecraftServerType): serverType is MinecraftInstallableType {
  return serverType !== 'unknown'
}

interface StartSettingsTabProps {
  profile: MinecraftProfile
  onProfileChange: (profile: MinecraftProfile) => void
}

export default function StartSettingsTab({ profile, onProfileChange }: StartSettingsTabProps): JSX.Element {
  const [form, setForm] = useState<MinecraftProfile>(profile)
  const [formError, setFormError] = useState('')
  const [redetecting, setRedetecting] = useState(false)
  const [mcVersionOptions, setMcVersionOptions] = useState<MinecraftVersionOption[]>([])
  const [loadingMcVersions, setLoadingMcVersions] = useState(false)
  const [mcVersionsError, setMcVersionsError] = useState('')
  const [loaderVersionOptions, setLoaderVersionOptions] = useState<MinecraftVersionOption[]>([])
  const [loadingLoaderVersions, setLoadingLoaderVersions] = useState(false)
  const [loaderVersionsError, setLoaderVersionsError] = useState('')

  // Same two-selector system "+ Add server" uses to install a server (Minecraft version,
  // then a loader/build version with a recommended one starred) - driven live from the same
  // window.api.minecraft.install APIs, just to label/display an already-set-up server here
  // rather than to install anything. 'unknown' has no real loader to ask about at all, so it
  // keeps the plain free-text fields these pickers replaced for everything else.
  useEffect(() => {
    let cancelled = false
    if (!isInstallableType(form.serverType)) {
      setMcVersionOptions([])
      setMcVersionsError('')
      return
    }
    setLoadingMcVersions(true)
    setMcVersionsError('')
    window.api.minecraft.install
      .listVersions(form.serverType)
      .then((options) => {
        if (!cancelled) setMcVersionOptions(options)
      })
      .catch((err: Error) => {
        if (!cancelled) setMcVersionsError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoadingMcVersions(false)
      })
    return () => {
      cancelled = true
    }
  }, [form.serverType])

  useEffect(() => {
    let cancelled = false
    if (!isInstallableType(form.serverType) || !supportsLoaderVersionSelection(form.serverType) || !form.minecraftVersion) {
      setLoaderVersionOptions([])
      setLoaderVersionsError('')
      return
    }
    setLoadingLoaderVersions(true)
    setLoaderVersionsError('')
    window.api.minecraft.install
      .listLoaderVersions(form.serverType, form.minecraftVersion)
      .then((options) => {
        if (!cancelled) setLoaderVersionOptions(options)
      })
      .catch((err: Error) => {
        if (!cancelled) setLoaderVersionsError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoadingLoaderVersions(false)
      })
    return () => {
      cancelled = true
    }
  }, [form.serverType, form.minecraftVersion])

  // Keeps whatever this profile already has set, even if it isn't (or isn't yet) in the live
  // list - a server set up before this picker existed, or on a version the live source has
  // since dropped, would otherwise just silently vanish from the dropdown instead of still
  // showing as selected.
  const mcVersionSelectOptions =
    form.minecraftVersion && !mcVersionOptions.some((o) => o.id === form.minecraftVersion)
      ? [{ id: form.minecraftVersion, label: form.minecraftVersion }, ...mcVersionOptions]
      : mcVersionOptions
  const loaderVersionSelectOptions =
    form.loaderVersion && !loaderVersionOptions.some((o) => o.id === form.loaderVersion)
      ? [{ id: form.loaderVersion, label: form.loaderVersion }, ...loaderVersionOptions]
      : loaderVersionOptions

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
        scriptFileName: detected.scriptFileName,
        serverType: detected.serverType
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
          Server type
          <div className="path-input-row">
            <select value={form.serverType} onChange={(e) => update('serverType', e.target.value as MinecraftServerType)}>
              {SERVER_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {MINECRAFT_SERVER_TYPE_ICONS[form.serverType] && (
              <img src={MINECRAFT_SERVER_TYPE_ICONS[form.serverType]} alt="" className="server-type-icon-large" />
            )}
          </div>
        </label>
        <p className="empty-state">
          Cosmetic only (shown on the Dashboard card) - best-effort guessed from the jar/script name on import or
          Re-detect below. Correct it here if it guessed wrong; it never affects how the server actually launches.
        </p>
        {isInstallableType(form.serverType) ? (
          <>
            <label>
              Minecraft version
              <select
                value={form.minecraftVersion}
                onChange={(e) => update('minecraftVersion', e.target.value)}
                disabled={loadingMcVersions}
              >
                <option value="">(not set)</option>
                {mcVersionSelectOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {loadingMcVersions && <p className="empty-state">Loading versions...</p>}
            {mcVersionsError && <p className="error-message">{mcVersionsError}</p>}
            {supportsLoaderVersionSelection(form.serverType) && (
              <label>
                Loader / build version
                <select
                  value={form.loaderVersion ?? ''}
                  onChange={(e) => update('loaderVersion', e.target.value)}
                  disabled={loadingLoaderVersions || !form.minecraftVersion}
                >
                  <option value="">(not set)</option>
                  {loaderVersionSelectOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.recommended ? `★ ${o.label}` : o.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {loadingLoaderVersions && <p className="empty-state">Loading loader/build versions...</p>}
            {loaderVersionsError && <p className="error-message">{loaderVersionsError}</p>}
          </>
        ) : (
          <label>
            Minecraft version
            <input value={form.minecraftVersion} onChange={(e) => update('minecraftVersion', e.target.value)} placeholder="1.20.1" />
          </label>
        )}
        <p className="empty-state">
          Not detected automatically - set it to whatever version this server actually runs. Required by the Mods
          tab to find compatible mods/plugins; the loader/build version itself is purely informational (nothing
          currently reads it), unused for &quot;Unknown&quot; server type.
        </p>
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
            />
          </label>
          <label>
            Max memory (MB)
            <input
              type="number"
              value={form.maxMemoryMB}
              onChange={(e) => update('maxMemoryMB', Number(e.target.value))}
            />
          </label>
        </div>
        {form.launchMode === 'script' && (
          <p className="empty-state">
            In launch mode &quot;script&quot;, memory and extra JVM arguments are written to
            <code>user_jvm_args.txt</code> in the install directory before every start - the file modern Forge&apos;s
            own generated script already reads for this. If your script is an older Forge version or a fully custom
            one that doesn&apos;t read that file, these fields won&apos;t have any effect.
          </p>
        )}
        <label>
          Extra JVM arguments
          <input value={form.extraJvmArgs} onChange={(e) => update('extraJvmArgs', e.target.value)} placeholder="-XX:+UseG1GC" />
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
          <input type="checkbox" checked={form.hidden} onChange={(e) => update('hidden', e.target.checked)} />
          Hide from the main dashboard
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.consoleLoggingEnabled}
            onChange={(e) => update('consoleLoggingEnabled', e.target.checked)}
          />
          Enable live console log
        </label>
        <p className="empty-state">
          Turn this off for a very chatty modpack if the Console tab is still laggy - Start/Stop, sending commands,
          and detecting when the server is ready all keep working either way; only the Console tab&apos;s own feed
          (and its saved history) is skipped.
        </p>
      </section>
    </form>
  )
}
