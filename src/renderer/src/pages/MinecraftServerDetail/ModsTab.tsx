import { useEffect, useState, type FormEvent } from 'react'
import type { MinecraftProfile } from '@shared/minecraft'
import { supportsMinecraftMods } from '@shared/minecraftMods'
import type { MinecraftModInstallResult, MinecraftModSearchResult, MinecraftModUpdateCheckResult } from '@shared/minecraftMods'
import { confirmAction } from '../../lib/confirmAction'

interface ModsTabProps {
  profile: MinecraftProfile
  onProfileChange: (profile: MinecraftProfile) => void
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

export default function ModsTab({ profile, onProfileChange }: ModsTabProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MinecraftModSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [lastNote, setLastNote] = useState('')
  const [updates, setUpdates] = useState<Record<string, MinecraftModUpdateCheckResult>>({})
  const [checkingUpdates, setCheckingUpdates] = useState(false)

  const supported = supportsMinecraftMods(profile.serverType)
  const hasVersion = profile.minecraftVersion.trim().length > 0

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

  useEffect(() => {
    if (!supported || !hasVersion) return
    void refreshUpdates()
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

  async function handleInstall(projectId: string): Promise<void> {
    setBusyId(projectId)
    setError('')
    setLastNote('')
    try {
      const { profile: updated, result } = await window.api.minecraft.mods.install(profile.id, projectId)
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

  async function handleUpdate(projectId: string): Promise<void> {
    setBusyId(projectId)
    setError('')
    setLastNote('')
    try {
      const { profile: updated, result } = await window.api.minecraft.mods.update(profile.id, projectId)
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
      </div>
    )
  }

  if (!hasVersion) {
    return (
      <div className="mods-tab">
        <p className="empty-state">
          Set this server&apos;s Minecraft version in Start Settings first - it&apos;s needed to find compatible
          mods/plugins.
        </p>
      </div>
    )
  }

  return (
    <div className="mods-tab">
      <section className="cluster-section">
        <h3>Browse Modrinth</h3>
        <p className="empty-state">
          Searching for {profile.serverType} mods/plugins compatible with Minecraft {profile.minecraftVersion}.
          Client-only content (nothing to do with a server) is already excluded. CurseForge is a planned follow-up,
          not available yet.
        </p>
        <form className="path-input-row" onSubmit={(e) => void handleSearch(e)}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search mods/plugins..." />
          <button type="submit" disabled={searching || !query.trim()}>
            {searching ? 'Searching...' : 'Search'}
          </button>
        </form>
        {error && <p className="error-message">{error}</p>}
        {lastNote && <p className="empty-state">{lastNote}</p>}
        <table className="mc-mods-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th>Downloads</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.projectId}>
                <td className="mc-mod-name-cell">
                  {r.iconUrl && <img src={r.iconUrl} alt="" className="mc-mod-icon" />}
                  {r.title}
                </td>
                <td>{r.description}</td>
                <td>{r.downloads.toLocaleString()}</td>
                <td>
                  <button
                    type="button"
                    disabled={r.installed || busyId === r.projectId}
                    onClick={() => void handleInstall(r.projectId)}
                  >
                    {r.installed ? 'Installed' : busyId === r.projectId ? 'Installing...' : 'Install'}
                  </button>
                </td>
              </tr>
            ))}
            {results.length === 0 && (
              <tr>
                <td colSpan={4}>{searched ? 'No results.' : 'Search above to find mods/plugins for this server.'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="cluster-section">
        <h3>Installed ({profile.installedMods.length})</h3>
        <div className="form-actions">
          <button type="button" onClick={() => void refreshUpdates()} disabled={checkingUpdates}>
            {checkingUpdates ? 'Checking...' : 'Check for updates'}
          </button>
        </div>
        <table className="mc-mods-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Version</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {profile.installedMods.map((m) => {
              const update = updates[m.projectId]
              return (
                <tr key={m.projectId}>
                  <td className="mc-mod-name-cell">
                    {m.iconUrl && <img src={m.iconUrl} alt="" className="mc-mod-icon" />}
                    {m.title}
                    {m.installedAs === 'dependency' && <span className="muted"> (dependency)</span>}
                  </td>
                  <td>{m.versionNumber}</td>
                  <td>{!m.enabled ? 'Disabled' : update?.updateAvailable ? 'Update available' : 'Up to date'}</td>
                  <td className="backup-management-actions">
                    {update?.updateAvailable && (
                      <button type="button" disabled={busyId === m.projectId} onClick={() => void handleUpdate(m.projectId)}>
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
                <td colSpan={4}>No mods/plugins installed yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
