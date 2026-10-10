import { useState } from 'react'
import type { MinecraftProfile, MinecraftServerType } from '@shared/minecraft'
import { minecraftModEcosystem } from '@shared/minecraftMods'
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

/** "Mods" and "Plugins" are mutually exclusive - a server's own ecosystem
 *  (minecraftModEcosystem) decides which one applies, never both at once - rather than one
 *  tab whose label just changes, so each loader's own user-facing terminology shows up as
 *  its own real tab (same ModsTab component/content underneath either way). Neither one
 *  shows at all for vanilla/unknown. */
function tabsFor(serverType: MinecraftServerType): Array<{ key: MinecraftTabKey; label: string }> {
  const ecosystem = minecraftModEcosystem(serverType)
  const modOrPluginsTab: Array<{ key: MinecraftTabKey; label: string }> =
    ecosystem === 'mods' ? [{ key: 'mods', label: 'Mods' }] : ecosystem === 'plugins' ? [{ key: 'plugins', label: 'Plugins' }] : []
  return [
    { key: 'console', label: 'Console' },
    { key: 'startSettings', label: 'Start Settings' },
    { key: 'serverSettings', label: 'Server Settings' },
    ...modOrPluginsTab,
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
          <ModsTab profile={profile} onProfileChange={onProfileChange} onGoToStartSettings={() => setTab('startSettings')} />
        )}
        {tab === 'backup' && <BackupsTab profile={profile} onProfileChange={onProfileChange} />}
        {tab === 'management' && <ServerManagementTab profile={profile} onProfileChange={onProfileChange} />}
      </div>
    </div>
  )
}
