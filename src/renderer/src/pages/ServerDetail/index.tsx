import { useState } from 'react'
import type { ServerProfile } from '@shared/types'
import ConsoleTab from './ConsoleTab'
import ConfigTab from './ConfigTab'
import ModsTab from './ModsTab'
import BackupsTab from './BackupsTab'
import SettingsTab from './SettingsTab'

type TabKey = 'console' | 'config' | 'mods' | 'backups' | 'settings'

interface ServerDetailProps {
  profile: ServerProfile
  onBack: () => void
  onProfileChange: (profile: ServerProfile) => void
}

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'console', label: 'Console & RCON' },
  { key: 'config', label: 'Config' },
  { key: 'mods', label: 'Mods' },
  { key: 'backups', label: 'Backups' },
  { key: 'settings', label: 'Settings' }
]

export default function ServerDetail({ profile, onBack, onProfileChange }: ServerDetailProps): JSX.Element {
  const [tab, setTab] = useState<TabKey>('console')

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
        {tab === 'config' && <ConfigTab profile={profile} />}
        {tab === 'mods' && <ModsTab profile={profile} onProfileChange={onProfileChange} />}
        {tab === 'backups' && <BackupsTab profile={profile} />}
        {tab === 'settings' && <SettingsTab profile={profile} onProfileChange={onProfileChange} />}
      </div>
    </div>
  )
}
