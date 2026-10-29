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

export interface MinecraftServerDetailTabMeta {
  key: MinecraftTabKey
  label: string
  icon: string
  group: 'Overview' | 'Configuration' | 'Maintenance'
}

const GROUP_ORDER: MinecraftServerDetailTabMeta['group'][] = ['Overview', 'Configuration', 'Maintenance']

/** Most server types get exactly one of "Mods" or "Plugins" (minecraftServerSupportsEcosystem
 *  decides which), never both - but SpongeForge genuinely offers both ecosystems at once (its
 *  own Sponge-plugin layer, and the underlying Forge-mod layer it runs on), so it gets both
 *  tabs, each independently backed by its own ModsTab instance (own ecosystem prop, own
 *  search/install, own slice of profile.installedMods - see ModsTab's own doc comment).
 *  Neither tab shows at all for vanilla/unknown.
 *
 *  Exported (as tabsFor) so the Dashboard's own card "..." menu can list these same tabs
 *  directly - same reasoning as ServerDetail's own SERVER_DETAIL_TABS. */
export function tabsFor(serverType: MinecraftServerType): MinecraftServerDetailTabMeta[] {
  const modOrPluginsTabs: MinecraftServerDetailTabMeta[] = []
  if (minecraftServerSupportsEcosystem(serverType, 'mods')) {
    modOrPluginsTabs.push({ key: 'mods', label: 'Mods', icon: '🧩', group: 'Configuration' })
  }
  if (minecraftServerSupportsEcosystem(serverType, 'plugins')) {
    modOrPluginsTabs.push({ key: 'plugins', label: 'Plugins', icon: '🔌', group: 'Configuration' })
  }
  return [
    { key: 'console', label: 'Console', icon: '🖥️', group: 'Overview' },
    { key: 'startSettings', label: 'Start Settings', icon: '🚀', group: 'Configuration' },
    { key: 'serverSettings', label: 'Server Settings', icon: '📝', group: 'Configuration' },
    ...modOrPluginsTabs,
    { key: 'backup', label: 'Backup', icon: '💾', group: 'Maintenance' },
    { key: 'management', label: 'Server Management', icon: '🛠️', group: 'Maintenance' }
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
  const activeTabMeta = tabs.find((t) => t.key === tab) ?? tabs[0]

  return (
    <div className="server-detail settings-view">
      <header className="server-detail-header">
        <button onClick={onBack}>&larr; Back</button>
        <h1>{profile.name}</h1>
      </header>

      <div className="settings-shell">
        <nav className="settings-nav">
          {GROUP_ORDER.map((group) => {
            const groupTabs = tabs.filter((t) => t.group === group)
            if (groupTabs.length === 0) return null
            return (
              <div className="settings-nav-group" key={group}>
                <div className="settings-nav-group-label">{group.toUpperCase()}</div>
                {groupTabs.map((t) => (
                  <button key={t.key} type="button" className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
                    <span className="settings-nav-icon">{t.icon}</span>
                    {t.label}
                  </button>
                ))}
              </div>
            )
          })}
        </nav>

        <div className="settings-content">
          <div className="settings-content-header">
            <h2>
              <span className="settings-nav-icon">{activeTabMeta.icon}</span>
              {activeTabMeta.label}
            </h2>
          </div>
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
    </div>
  )
}
