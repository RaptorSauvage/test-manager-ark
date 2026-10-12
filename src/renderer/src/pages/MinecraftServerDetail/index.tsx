import { useState } from 'react'
import type { MinecraftProfile, MinecraftServerType } from '@shared/minecraft'
import { minecraftServerSupportsEcosystem } from '@shared/minecraftMods'
import ConsoleTab from './ConsoleTab'
import StartSettingsTab from './StartSettingsTab'
import ServerSettingsTab from './ServerSettingsTab'
import ModsTab from './ModsTab'
import BackupsTab from './BackupsTab'
import ServerManagementTab from './ServerManagementTab'

export type MinecraftTabKey = 'console' | 'startSettings' | 'serverSettings' | 'mods' | 'plugins' | 'backup' | 'management'

interface MinecraftServerDetailProps {
  profile: MinecraftProfile
  initialTab?: MinecraftTabKey
  onBack: () => void
  onProfileChange: (profile: MinecraftProfile) => void
}

/** Most server types get exactly one of "Mods" or "Plugins" (minecraftServerSupportsEcosystem
 *  decides which), never both - but SpongeForge genuinely offers both ecosystems at once (its
 *  own Sponge-plugin layer, and the underlying Forge-mod layer it runs on), so it gets both
 *  tabs, each independently backed by its own ModsTab instance (own ecosystem prop, own
 *  search/install, own slice of profile.installedMods - see ModsTab's own doc comment).
 *  Neither tab shows at all for vanilla/unknown. */
function tabsFor(serverType: MinecraftServerType): Array<{ key: MinecraftTabKey; label: string }> {
  const modOrPluginsTabs: Array<{ key: MinecraftTabKey; label: string }> = []
  if (minecraftServerSupportsEcosystem(serverType, 'mods')) modOrPluginsTabs.push({ key: 'mods', label: 'Mods' })
  if (minecraftServerSupportsEcosystem(serverType, 'plugins')) modOrPluginsTabs.push({ key: 'plugins', label: 'Plugins' })
  return [
    { key: 'console', label: 'Console' },
    { key: 'startSettings', label: 'Start Settings' },
    { key: 'serverSettings', label: 'Server Settings' },
    ...modOrPluginsTabs,
    { key: 'backup', label: 'Backup' },
    { key: 'management', label: 'Server Management' }
  ]
}

export default function MinecraftServerDetail({
  profile,
  initialTab,
  onBack,
  onProfileChange
}: MinecraftServerDetailProps): JSX.Element {
  const [tab, setTab] = useState<MinecraftTabKey>(initialTab ?? 'console')
  const tabs = tabsFor(profile.serverType)

  return (
    <div className="server-detail">
      <header className="server-detail-header">
        <button onClick={onBack}>&larr; Back</button>
        <h1>{profile.name}</h1>
      </header>
      <nav className="tab-nav">
        {tabs.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="tab-content">
        {tab === 'console' && <ConsoleTab profile={profile} />}
        {tab === 'startSettings' && <StartSettingsTab profile={profile} onProfileChange={onProfileChange} />}
        {tab === 'serverSettings' && <ServerSettingsTab profile={profile} />}
        {(tab === 'mods' || tab === 'plugins') && (
          <ModsTab
            profile={profile}
            ecosystem={tab}
            onProfileChange={onProfileChange}
            onGoToStartSettings={() => setTab('startSettings')}
          />
        )}
        {tab === 'backup' && <BackupsTab profile={profile} onProfileChange={onProfileChange} />}
        {tab === 'management' && <ServerManagementTab profile={profile} onProfileChange={onProfileChange} />}
      </div>
    </div>
  )
}
