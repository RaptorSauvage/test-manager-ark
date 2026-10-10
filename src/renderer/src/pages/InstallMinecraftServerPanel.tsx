import { useEffect, useState } from 'react'
import type { MinecraftInstallableType } from '@shared/minecraftInstall'
import type { MinecraftProfile } from '@shared/minecraft'
import { createDefaultMinecraftProfile } from '../lib/minecraftProfile'
import { MINECRAFT_SERVER_TYPE_ICONS } from '../lib/minecraftServerTypeIcons'

interface InstallMinecraftServerPanelProps {
  existingNameCount: number
  onInstalled: (profile: MinecraftProfile) => void
  onCancel: () => void
}

const SERVER_TYPE_OPTIONS: Array<{ value: MinecraftInstallableType; label: string; hint: string }> = [
  { value: 'vanilla', label: 'Vanilla', hint: "Mojang's own server, no mods or plugins." },
  { value: 'paper', label: 'Paper', hint: 'High-performance fork with a plugin ecosystem (Bukkit/Spigot-compatible).' },
  { value: 'fabric', label: 'Fabric', hint: 'Lightweight, widely-used modding platform.' },
  { value: 'forge', label: 'Forge', hint: 'The original modding platform - the largest modpack ecosystem.' },
  { value: 'neoforge', label: 'NeoForge', hint: "Forge's modern successor - most new Forge-ecosystem modpacks target this instead today." },
  {
    value: 'spigot',
    label: 'Spigot',
    hint: 'Compiled locally from source via BuildTools (per Spigot\'s own license terms) - needs a JDK and Git on PATH, and can take several minutes. Paper is a faster, drop-in-compatible alternative most servers prefer today.'
  }
]

/**
 * "+ Add server"'s install-from-scratch path - fetches/builds the right files for a brand
 * new server instead of requiring one to already exist on disk (that's "Import existing
 * server"). A thin wizard over window.api.minecraft.install (minecraftInstall.ts/
 * minecraftInstallClient.ts in the main process) - this component only drives the three
 * picks (type/version/install directory) plus the EULA checkbox the install itself requires,
 * then builds and saves the MinecraftProfile from whatever install() returns.
 */
export default function InstallMinecraftServerPanel({
  existingNameCount,
  onInstalled,
  onCancel
}: InstallMinecraftServerPanelProps): JSX.Element {
  const [serverType, setServerType] = useState<MinecraftInstallableType>('paper')
  const [versions, setVersions] = useState<string[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [versionsError, setVersionsError] = useState('')
  const [minecraftVersion, setMinecraftVersion] = useState('')
  const [installDir, setInstallDir] = useState('')
  const [name, setName] = useState(`Minecraft Server ${existingNameCount + 1}`)
  const [acceptEula, setAcceptEula] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState('')
  const [progressMessage, setProgressMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoadingVersions(true)
    setVersionsError('')
    setMinecraftVersion('')
    window.api.minecraft.install
      .listVersions(serverType)
      .then((options) => {
        if (cancelled) return
        setVersions(options.map((o) => o.id))
        if (options[0]) setMinecraftVersion(options[0].id)
      })
      .catch((err: Error) => {
        if (!cancelled) setVersionsError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoadingVersions(false)
      })
    return () => {
      cancelled = true
    }
  }, [serverType])

  async function browseInstallDir(): Promise<void> {
    const dir = await window.api.dialog.selectDirectory()
    if (dir) setInstallDir(dir)
  }

  async function handleInstall(): Promise<void> {
    setInstallError('')
    if (!minecraftVersion) {
      setInstallError('Pick a Minecraft version first.')
      return
    }
    if (!installDir.trim()) {
      setInstallError('Pick an install directory first.')
      return
    }
    if (!acceptEula) {
      setInstallError('You must accept the Minecraft EULA to continue.')
      return
    }
    setInstalling(true)
    setProgressMessage(
      serverType === 'forge'
        ? 'Downloading and running the Forge installer...'
        : serverType === 'spigot'
          ? 'Downloading BuildTools and compiling Spigot - this can take several minutes...'
          : 'Downloading server files...'
    )
    try {
      const result = await window.api.minecraft.install.run({
        serverType,
        minecraftVersion,
        installDir,
        acceptEula
      })
      const profile: MinecraftProfile = {
        ...createDefaultMinecraftProfile(name || `Minecraft Server ${existingNameCount + 1}`),
        installDir: result.installDir,
        minecraftVersion: result.minecraftVersion,
        serverType: result.serverType,
        launchMode: result.launchMode,
        jarFileName: result.jarFileName,
        scriptFileName: result.scriptFileName
      }
      onInstalled(profile)
    } catch (err) {
      setInstallError((err as Error).message)
    } finally {
      setInstalling(false)
      setProgressMessage('')
    }
  }

  const selectedOption = SERVER_TYPE_OPTIONS.find((o) => o.value === serverType)

  return (
    <section className="cluster-section install-minecraft-panel">
      <h3>Install a new Minecraft server</h3>
      <p className="empty-state">
        Downloads (and, for Forge/Spigot, builds) the right server files into an empty folder - for a server
        that&apos;s already set up somewhere, use &quot;Import existing server&quot; instead.
      </p>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={installing} />
      </label>
      <label>
        Server type
        <div className="path-input-row">
          <select value={serverType} onChange={(e) => setServerType(e.target.value as MinecraftInstallableType)} disabled={installing}>
            {SERVER_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {MINECRAFT_SERVER_TYPE_ICONS[serverType] && (
            <img src={MINECRAFT_SERVER_TYPE_ICONS[serverType]} alt="" className="server-type-icon-large" />
          )}
        </div>
      </label>
      {selectedOption && <p className="empty-state">{selectedOption.hint}</p>}
      <label>
        Minecraft version
        <select value={minecraftVersion} onChange={(e) => setMinecraftVersion(e.target.value)} disabled={installing || loadingVersions}>
          {versions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {loadingVersions && <p className="empty-state">Loading versions...</p>}
      {versionsError && <p className="error-message">{versionsError}</p>}
      <label>
        Install directory
        <div className="path-input-row">
          <input
            value={installDir}
            onChange={(e) => setInstallDir(e.target.value)}
            placeholder="C:\Minecraft\Server"
            disabled={installing}
          />
          <button type="button" onClick={() => void browseInstallDir()} disabled={installing}>
            Browse...
          </button>
        </div>
        <p className="empty-state">Should be an empty (or non-existent, it will be created) folder.</p>
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={acceptEula} onChange={(e) => setAcceptEula(e.target.checked)} disabled={installing} />
        I have read and accept the{' '}
        <a href="https://www.minecraft.net/eula" target="_blank" rel="noreferrer">
          Minecraft EULA
        </a>
      </label>
      {progressMessage && <p className="empty-state">{progressMessage}</p>}
      {installError && <p className="error-message">{installError}</p>}
      <div className="form-actions">
        <button onClick={() => void handleInstall()} disabled={installing || loadingVersions}>
          {installing ? 'Installing...' : 'Install'}
        </button>
        <button type="button" onClick={onCancel} disabled={installing}>
          Cancel
        </button>
      </div>
    </section>
  )
}
