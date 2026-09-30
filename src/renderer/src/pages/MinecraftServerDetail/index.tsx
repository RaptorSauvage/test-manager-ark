import { useState } from 'react'
import type { MinecraftProfile } from '@shared/minecraft'
import ConsoleTab from './ConsoleTab'
import StartSettingsTab from './StartSettingsTab'
import ServerSettingsTab from './ServerSettingsTab'
import BackupsTab from './BackupsTab'
import ServerManagementTab from './ServerManagementTab'

export type MinecraftTabKey = 'console' | 'startSettings' | 'serverSettings' | 'backup' | 'management'

interface MinecraftServerDetailProps {
  profile: MinecraftProfile
  initialTab?: MinecraftTabKey
  onBack: () => void
  onProfileChange: (profile: MinecraftProfile) => void
}

const TABS: Array<{ key: MinecraftTabKey; label: string }> = [
  { key: 'console', label: 'Console' },
  { key: 'startSettings', label: 'Start Settings' },
  { key: 'serverSettings', label: 'Server Settings' },
  { key: 'backup', label: 'Backup' },
  { key: 'management', label: 'Server Management' }
]

export default function MinecraftServerDetail({
  profile,
  initialTab,
  onBack,
  onProfileChange
}: MinecraftServerDetailProps): JSX.Element {
  const [tab, setTab] = useState<MinecraftTabKey>(initialTab ?? 'console')

  return (
    <div className="server-detail">
      <header className="server-detail-header">
        <button onClick={onBack}>&larr; Back</button>
        <h1>{profile.name}</h1>
      </header>
      <nav className="tab-nav">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="tab-content">
        {tab === 'console' && <ConsoleTab profile={profile} />}
        {tab === 'startSettings' && <StartSettingsTab profile={profile} onProfileChange={onProfileChange} />}
        {tab === 'serverSettings' && <ServerSettingsTab profile={profile} />}
        {tab === 'backup' && <BackupsTab profile={profile} onProfileChange={onProfileChange} />}
        {tab === 'management' && <ServerManagementTab profile={profile} onProfileChange={onProfileChange} />}
      </div>
    </div>
  )
}
