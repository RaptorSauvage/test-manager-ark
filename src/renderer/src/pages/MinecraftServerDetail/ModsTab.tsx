import { useEffect, useState, type FormEvent } from 'react'
import type { MinecraftProfile } from '@shared/minecraft'
import { supportsMinecraftMods } from '@shared/minecraftMods'
import type {
  MinecraftModInstallResult,
  MinecraftModSearchResult,
  MinecraftModSource,
  MinecraftModUpdateCheckResult
} from '@shared/minecraftMods'
import { confirmAction } from '../../lib/confirmAction'

function sourceLabel(source: MinecraftModSource): string {
  return source === 'curseforge' ? 'CurseForge' : 'Modrinth'
}

interface ModsTabProps {
  profile: MinecraftProfile
  onProfileChange: (profile: MinecraftProfile) => void
  onGoToStartSettings: () => void
}

/** Turns an install/update result into one readable line - dependencies pulled in, optional
 *  ones left out, and anything flagged incompatible with what's already installed. Nothing
 *  to say beyond "Installed X" is the common case, so the extra clauses only appear when
 *  there's actually something to report. */
function describeInstallResult(result: MinecraftModInstallResult): string {
  const parts = [`Installed ${result.installed[0]?.title ?? ''}`]
  if (result.dependenciesInstalled.length > 0) {
    parts.push(`also installed as required dependencies: ${result.dependenciesInstalled.map((d) => d.title).join(', ')}`)
  }
  if (result.optionalDependenciesSkipped.length > 0) {
    parts.push(
      `optional dependencies not installed (add by hand if wanted): ${result.optionalDependenciesSkipped
        .map((d) => d.projectId)
        .join(', ')}`
    )
  }
  if (result.incompatibleWithInstalled.length > 0) {
    parts.push(
      `warning - declared incompatible with an already-installed mod: ${result.incompatibleWithInstalled
        .map((d) => d.projectId)
        .join(', ')}`
    )
  }
  return parts.join(' - ')
}

export default function ModsTab({ profile, onProfileChange, onGoToStartSettings }: ModsTabProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MinecraftModSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [lastNote, setLastNote] = useState('')
  const [updates, setUpdates] = useState<Record<string, MinecraftModUpdateCheckResult>>({})
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanNote, setScanNote] = useState('')
  const [hasCurseForgeKey, setHasCurseForgeKey] = useState(false)

  const supported = supportsMinecraftMods(profile.serverType)
  const hasVersion = profile.minecraftVersion.trim().length > 0

  useEffect(() => {
    window.api.settings.get().then((settings) => setHasCurseForgeKey(settings.curseforgeApiKey.trim().length > 0))
  }, [])

  async function refreshUpdates(): Promise<void> {
    setCheckingUpdates(true)
    try {
      const checked = await window.api.minecraft.mods.checkUpdates(profile.id)
      setUpdates(Object.fromEntries(checked.map((r) => [r.projectId, r])))
    } catch {
      // Best-effort - a failed update check shouldn't block the rest of the tab.
    } finally {
      setCheckingUpdates(false)
    }
  }

  /** Recognizes mods/plugins already sitting in the mods/plugins folder that weren't
   *  installed through this tab - dropped in by hand, or installed before this feature
   *  existed. Run automatically whenever the tab opens for a profile, plus an explicit
   *  "Rescan folder" button for after the user adds files while the tab is already open.
   *  Every untracked file ends up in profile.installedMods either way - a hash match gets
   *  full Modrinth info (source: 'modrinth'), anything else is still added so it's visible
   *  and manageable, just as source: 'unknown' (see the Status column below). */
  async function handleScan(): Promise<void> {
    setScanning(true)
    try {
      const { profile: updated, result } = await window.api.minecraft.mods.scan(profile.id)
      if (result.adopted.length > 0) onProfileChange(updated)
      if (result.adopted.length > 0) {
        const identified = result.adopted.filter((m) => m.source === 'modrinth')
        const unidentified = result.adopted.filter((m) => m.source === 'unknown')
        const parts: string[] = []
        if (identified.length > 0) {
          parts.push(`Recognized ${identified.length} already-installed mod${identified.length === 1 ? '' : 's'}: ${identified.map((m) => m.title).join(', ')}`)
        }
        if (unidentified.length > 0) {
          parts.push(
            `${unidentified.length} file${unidentified.length === 1 ? '' : 's'} in the folder could not be identified (not on Modrinth, or CurseForge-sourced) - added below as "Unidentified", still manageable`
          )
        }
        setScanNote(parts.join(' - '))
      } else {
        setScanNote('')
      }
    } catch {
      // Best-effort - a failed scan shouldn't block the rest of the tab.
    } finally {
      setScanning(false)
    }
  }

  async function handleOpenModsFolder(): Promise<void> {
    setError('')
    try {
      await window.api.minecraft.mods.openFolder(profile.id)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    if (!supported) return
    if (hasVersion) {
      void handleScan().then(() => refreshUpdates())
    } else {
      void handleScan()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id])

  async function handleSearch(e: FormEvent): Promise<void> {
    e.preventDefault()
    setSearching(true)
    setSearched(true)
    setError('')
    try {
      const hits = await window.api.minecraft.mods.search(profile.id, query)
      setResults(hits)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSearching(false)
    }
  }

  async function handleInstall(source: MinecraftModSource, projectId: string): Promise<void> {
    setBusyId(projectId)
    setError('')
    setLastNote('')
    try {
      const { profile: updated, result } = await window.api.minecraft.mods.install(profile.id, source, projectId)
      onProfileChange(updated)
      setResults((prev) => prev.map((r) => (r.projectId === projectId ? { ...r, installed: true } : r)))
      setLastNote(describeInstallResult(result))
      void refreshUpdates()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleUpdate(source: MinecraftModSource, projectId: string): Promise<void> {
    setBusyId(projectId)
    setError('')
    setLastNote('')
    try {
      const { profile: updated, result } = await window.api.minecraft.mods.update(profile.id, source, projectId)
      onProfileChange(updated)
      setLastNote(describeInstallResult(result))
      void refreshUpdates()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleRemove(projectId: string, title: string): Promise<void> {
    if (!confirmAction(`Remove ${title}? The installed file is deleted.`)) return
    setError('')
    try {
      const updated = await window.api.minecraft.mods.remove(profile.id, projectId)
      onProfileChange(updated)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function handleToggleEnabled(projectId: string, enabled: boolean): Promise<void> {
    setError('')
    try {
      const updated = await window.api.minecraft.mods.setEnabled(profile.id, projectId, enabled)
      onProfileChange(updated)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (!supported) {
    return (
      <div className="mods-tab">
        <p className="empty-state">
          {profile.serverType === 'vanilla'
            ? "Vanilla servers don't support mods or plugins."
            : 'Set Server type to Forge/Fabric/Paper/Spigot in Start Settings to use this tab.'}
        </p>
        {profile.serverType !== 'vanilla' && (
          <button type="button" onClick={onGoToStartSettings}>
            Go to Start Settings
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="mods-tab">
      {hasVersion ? (
        <section className="cluster-section">
          <h3>Browse Modrinth{hasCurseForgeKey ? ' & CurseForge' : ''}</h3>
          <p className="empty-state">
            Searching for {profile.serverType} mods/plugins compatible with Minecraft {profile.minecraftVersion}.
            Client-only content (nothing to do with a server) is already excluded.
            {hasCurseForgeKey
              ? ' Results below are merged from both Modrinth and CurseForge, each labeled with its source.'
              : ' Set a CurseForge API key in Settings (General) to also search CurseForge - see the README for where to get one.'}
          </p>
          <form className="path-input-row" onSubmit={(e) => void handleSearch(e)}>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search mods/plugins..." />
            <button type="submit" disabled={searching || !query.trim()}>
              {searching ? 'Searching...' : 'Search'}
            </button>
          </form>
          {error && <p className="error-message">{error}</p>}
          {lastNote && <p className="empty-state">{lastNote}</p>}
          <table className="mc-mods-table mc-mods-table--browse">
            <thead>
              <tr>
                <th className="mc-mods-col-name">Name</th>
                <th>Description</th>
                <th className="mc-mods-col-narrow">Source</th>
                <th className="mc-mods-col-narrow">Downloads</th>
                <th className="mc-mods-col-narrow"></th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={`${r.source}:${r.projectId}`}>
                  <td className="mc-mod-name-cell">
                    {r.iconUrl && (
                      <img
                        src={r.iconUrl}
                        alt=""
                        className="mc-mod-icon"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                        }}
                      />
                    )}
                    {r.title}
                  </td>
                  <td>{r.description}</td>
                  <td className="mc-mods-col-narrow muted">{sourceLabel(r.source)}</td>
                  <td className="mc-mods-col-narrow">{r.downloads.toLocaleString()}</td>
                  <td className="mc-mods-col-narrow">
                    <button
                      type="button"
                      disabled={r.installed || busyId === r.projectId}
                      onClick={() => void handleInstall(r.source, r.projectId)}
                    >
                      {r.installed ? 'Installed' : busyId === r.projectId ? 'Installing...' : 'Install'}
                    </button>
                  </td>
                </tr>
              ))}
              {results.length === 0 && (
                <tr>
                  <td colSpan={5}>{searched ? 'No results.' : 'Search above to find mods/plugins for this server.'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      ) : (
        <section className="cluster-section">
          <h3>Browse Modrinth &amp; CurseForge</h3>
          <p className="empty-state">
            Set this server&apos;s Minecraft version in Start Settings to search for and install mods/plugins. Mods
            already in the mods/plugins folder can still be recognized below without it.
          </p>
          <button type="button" onClick={onGoToStartSettings}>
            Go to Start Settings
          </button>
        </section>
      )}

      <section className="cluster-section">
        <h3>Installed ({profile.installedMods.length})</h3>
        <div className="form-actions">
          <button type="button" onClick={() => void handleScan()} disabled={scanning}>
            {scanning ? 'Scanning...' : 'Rescan folder'}
          </button>
          <button type="button" onClick={() => void refreshUpdates()} disabled={checkingUpdates || !hasVersion}>
            {checkingUpdates ? 'Checking...' : 'Check for updates'}
          </button>
          <button type="button" onClick={() => void handleOpenModsFolder()}>
            Open mods folder
          </button>
        </div>
        {scanNote && <p className="empty-state">{scanNote}</p>}
        <table className="mc-mods-table">
          <thead>
            <tr>
              <th className="mc-mods-col-name">Name</th>
              <th className="mc-mods-col-narrow">Source</th>
              <th className="mc-mods-col-narrow">Version</th>
              <th className="mc-mods-col-narrow">Status</th>
              <th className="mc-mods-col-narrow"></th>
            </tr>
          </thead>
          <tbody>
            {profile.installedMods.map((m) => {
              const update = updates[m.projectId]
              const unidentified = m.source === 'unknown'
              return (
                <tr key={m.projectId}>
                  <td className="mc-mod-name-cell">
                    {m.iconUrl && (
                      <img
                        src={m.iconUrl}
                        alt=""
                        className="mc-mod-icon"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                        }}
                      />
                    )}
                    {m.title}
                    {m.installedAs === 'dependency' && <span className="muted"> (dependency)</span>}
                  </td>
                  <td className="mc-mods-col-narrow muted">{unidentified ? '—' : sourceLabel(m.source)}</td>
                  <td className="mc-mods-col-narrow">{m.versionNumber || '—'}</td>
                  <td className="mc-mods-col-narrow">
                    {unidentified ? (
                      <span className="muted" title="Not found on Modrinth (CurseForge-sourced, hand-built, or hash didn't match) - enable/disable/remove still work.">
                        Unidentified
                      </span>
                    ) : !m.enabled ? (
                      'Disabled'
                    ) : update?.updateAvailable ? (
                      'Update available'
                    ) : (
                      'Up to date'
                    )}
                  </td>
                  <td className="mc-mods-col-narrow backup-management-actions">
                    {update?.updateAvailable && (
                      <button
                        type="button"
                        disabled={busyId === m.projectId}
                        onClick={() => void handleUpdate(m.source, m.projectId)}
                      >
                        {busyId === m.projectId ? 'Updating...' : 'Update'}
                      </button>
                    )}
                    <button type="button" onClick={() => void handleToggleEnabled(m.projectId, !m.enabled)}>
                      {m.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button type="button" className="danger" onClick={() => void handleRemove(m.projectId, m.title)}>
                      Remove
                    </button>
                  </td>
                </tr>
              )
            })}
            {profile.installedMods.length === 0 && (
              <tr>
                <td colSpan={5}>No mods/plugins installed yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
