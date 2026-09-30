import { useEffect, useState } from 'react'
import type { MinecraftProfile, MinecraftRunState, MinecraftServerType } from '@shared/minecraft'
import { useMinecraftServerStatuses } from '../lib/useMinecraftServerStatuses'
import { createDefaultMinecraftProfile } from '../lib/minecraftProfile'
import { confirmAction } from '../lib/confirmAction'
import type { MinecraftTabKey } from './MinecraftServerDetail'
import minecraftIcon from '../assets/games/minecraft.png'

const SERVER_TYPE_LABELS: Record<MinecraftServerType, string> = {
  vanilla: 'Vanilla',
  paper: 'Paper',
  spigot: 'Spigot',
  fabric: 'Fabric',
  forge: 'Forge',
  unknown: 'Unknown'
}

interface MinecraftDashboardProps {
  profiles: MinecraftProfile[]
  onProfilesChange: (profiles: MinecraftProfile[]) => void
  onOpenProfile: (id: string, tab?: MinecraftTabKey) => void
}

export default function MinecraftDashboard({
  profiles,
  onProfilesChange,
  onOpenProfile
}: MinecraftDashboardProps): JSX.Element {
  const statuses = useMinecraftServerStatuses(profiles.map((p) => p.id))
  const visibleProfiles = profiles.filter((p) => !p.hidden)
  const hiddenProfiles = profiles.filter((p) => p.hidden)
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  const [portById, setPortById] = useState<Record<string, string>>({})
  const [localIp, setLocalIp] = useState('localhost')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    void window.api.webDashboard.getLocalIps().then((ips) => {
      if (ips[0]) setLocalIp(ips[0])
    })
  }, [])

  // One read of server.properties per profile, for the server-port shown on its card - not
  // wired up to live-refresh on every change, since the port practically never changes while
  // the Manager is open; re-fetched whenever the profile list itself changes (import/create/
  // delete), same "cheap, not polled" pattern as Dashboard.tsx's own installedById/
  // gameVersionById effects.
  useEffect(() => {
    let cancelled = false
    void Promise.all(
      profiles.map(async (p) => {
        const props = await window.api.minecraft.properties.get(p.id)
        return [p.id, props['server-port'] ?? '25565'] as const
      })
    ).then((entries) => {
      if (!cancelled) setPortById(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles.map((p) => p.id).join(',')])

  async function copyAddress(profileId: string, address: string): Promise<void> {
    await navigator.clipboard.writeText(address)
    setCopiedId(profileId)
    setTimeout(() => setCopiedId((prev) => (prev === profileId ? null : prev)), 1500)
  }

  async function handleImport(): Promise<void> {
    setImportError('')
    const installDir = await window.api.dialog.selectDirectory()
    if (!installDir) return

    setImporting(true)
    try {
      const detected = await window.api.minecraft.profiles.importFromInstall(installDir)
      // The import IPC handler deliberately doesn't save the detected profile itself (see
      // shared/minecraft.ts) - persisted here, right away, so it shows up on the dashboard
      // and opens straight into Settings for review, same flow as ARK's own import. Every
      // Settings tab field auto-saves on change, so a correction made there immediately
      // overwrites this best-effort guess.
      const updated = await window.api.minecraft.profiles.save(detected)
      onProfilesChange(updated)
      onOpenProfile(detected.id, 'startSettings')
    } catch (err) {
      setImportError((err as Error).message)
    } finally {
      setImporting(false)
    }
  }

  async function handleCreate(): Promise<void> {
    const profile = createDefaultMinecraftProfile(`Minecraft Server ${profiles.length + 1}`)
    const updated = await window.api.minecraft.profiles.save(profile)
    onProfilesChange(updated)
    onOpenProfile(profile.id, 'startSettings')
  }

  async function handleDelete(id: string): Promise<void> {
    if (!confirmAction('Delete this server profile? This does not delete any files on disk.')) return
    const updated = await window.api.minecraft.profiles.delete(id)
    onProfilesChange(updated)
  }

  async function handleToggleHidden(profile: MinecraftProfile): Promise<void> {
    const updated = await window.api.minecraft.profiles.save({ ...profile, hidden: !profile.hidden })
    onProfilesChange(updated)
  }

  async function runAction(profile: MinecraftProfile, action: () => Promise<unknown>): Promise<void> {
    setActionErrors((prev) => ({ ...prev, [profile.id]: '' }))
    try {
      await action()
    } catch (err) {
      setActionErrors((prev) => ({ ...prev, [profile.id]: (err as Error).message }))
    }
  }

  async function handleStart(profile: MinecraftProfile): Promise<void> {
    await runAction(profile, () => window.api.minecraft.server.start(profile.id))
  }

  async function handleStop(profile: MinecraftProfile): Promise<void> {
    await runAction(profile, () => window.api.minecraft.server.stop(profile.id))
  }

  async function handleKill(profile: MinecraftProfile): Promise<void> {
    if (!confirmAction(`Force-kill "${profile.name}" without a graceful save? Progress since the last autosave will be lost.`)) return
    await runAction(profile, () => window.api.minecraft.server.kill(profile.id))
  }

  function renderCard(profile: MinecraftProfile): JSX.Element {
    const status = statuses[profile.id]
    const state: MinecraftRunState = status?.state ?? 'stopped'
    return (
      <div className="server-card" key={profile.id}>
        <div className="server-card-header">
          <img src={minecraftIcon} alt="" title="Minecraft" className="server-card-game-icon" />
          <h2>{profile.name}</h2>
          <span className={`badge badge-${state}`}>{state}</span>
        </div>
        <dl className="server-card-info">
          {status?.cpu !== undefined && (
            <div>
              <dt>CPU</dt>
              <dd>{status.cpu}%</dd>
            </div>
          )}
          <div>
            <dt>Players</dt>
            <dd>
              {status?.players
                ? `${status.players.length}${status.maxPlayers !== undefined ? `/${status.maxPlayers}` : ''}`
                : '-'}
            </dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{SERVER_TYPE_LABELS[profile.serverType]}</dd>
          </div>
          {status?.memoryMB !== undefined && (
            <div>
              <dt>RAM</dt>
              <dd>{status.memoryMB} MB</dd>
            </div>
          )}
          <div className="server-card-info-address">
            <dt>Address</dt>
            <dd>
              <button
                type="button"
                className="copyable-address"
                onClick={() => void copyAddress(profile.id, `${localIp}:${portById[profile.id] ?? '25565'}`)}
                title="Click to copy"
              >
                {copiedId === profile.id ? 'Copied!' : `${localIp}:${portById[profile.id] ?? '25565'}`}
              </button>
            </dd>
          </div>
        </dl>
        {status?.lastError && <p className="error-message">{status.lastError}</p>}
        {actionErrors[profile.id] && <p className="error-message">{actionErrors[profile.id]}</p>}
        <div className="server-card-actions-primary">
          <button className="start" disabled={state !== 'stopped'} onClick={() => void handleStart(profile)}>
            Start
          </button>
          <button className="stop" disabled={state !== 'running'} onClick={() => void handleStop(profile)}>
            Stop
          </button>
          <button
            className="kill"
            disabled={state === 'stopped'}
            onClick={() => void handleKill(profile)}
            title="Force-kill immediately, without a graceful save"
          >
            Kill
          </button>
        </div>
        <div className="server-card-actions-secondary">
          <button onClick={() => onOpenProfile(profile.id)}>Manage</button>
          <button
            onClick={() => void handleToggleHidden(profile)}
            title={profile.hidden ? 'Show this server on the main dashboard again' : 'Hide this server from the main dashboard'}
          >
            {profile.hidden ? 'Unhide' : 'Hide'}
          </button>
          <button className="danger" onClick={() => void handleDelete(profile.id)}>
            Delete
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Minecraft Servers</h1>
        <div className="dashboard-header-actions">
          <button onClick={() => void handleImport()} disabled={importing}>
            {importing ? 'Scanning...' : 'Import existing server'}
          </button>
          <button onClick={() => void handleCreate()}>+ Add server</button>
        </div>
      </header>

      {importError && <p className="error-message">{importError}</p>}

      <div className="dashboard-body">
        <div className="dashboard-content">
          {profiles.length === 0 && (
            <p className="empty-state">
              No Minecraft servers yet. Click &quot;Import existing server&quot; to point at a folder that already has
              a Minecraft server set up (server.properties/eula.txt, plus a jar or launch script), or &quot;+ Add
              server&quot; to configure one by hand.
            </p>
          )}
          {profiles.length > 0 && visibleProfiles.length === 0 && (
            <p className="empty-state">
              Every Minecraft server is hidden. Expand &quot;Hidden servers&quot; below to unhide one.
            </p>
          )}

          <div className="server-grid">{visibleProfiles.map(renderCard)}</div>

          {hiddenProfiles.length > 0 && (
            <details className="hidden-servers">
              <summary>Hidden servers ({hiddenProfiles.length})</summary>
              <div className="server-grid">{hiddenProfiles.map(renderCard)}</div>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}
