import { useState } from 'react'
import type { ServerProfile } from '@shared/types'
import AnalyticsTab from './AnalyticsTab'
import ModsTab from './ModsTab'
import BackupsTab from './BackupsTab'
import SettingsTab from './SettingsTab'
import ServerManagementTab from './ServerManagementTab'
import MapManagementTab from './MapManagementTab'

export type TabKey = 'analytics' | 'mods' | 'backups' | 'management' | 'mapManagement' | 'settings'

interface ServerDetailProps {
  profile: ServerProfile
  initialTab?: TabKey
  onBack: () => void
  onProfileChange: (profile: ServerProfile) => void
}

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'analytics', label: 'Analytics' },
  { key: 'settings', label: 'Settings' },
  { key: 'mods', label: 'Mods' },
  { key: 'backups', label: 'Backups' },
  { key: 'management', label: 'Server Management' },
  { key: 'mapManagement', label: 'Map Management' }
]

export default function ServerDetail({ profile, initialTab, onBack, onProfileChange }: ServerDetailProps): JSX.Element {
  const [tab, setTab] = useState<TabKey>(initialTab ?? 'analytics')

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
        {tab === 'analytics' && <AnalyticsTab profile={profile} onProfileChange={onProfileChange} />}
        {tab === 'mods' && <ModsTab profile={profile} onProfileChange={onProfileChange} />}
        {tab === 'backups' && <BackupsTab profile={profile} onProfileChange={onProfileChange} />}
        {tab === 'management' && <ServerManagementTab profile={profile} onProfileChange={onProfileChange} />}
        {tab === 'mapManagement' && <MapManagementTab profile={profile} />}
        {tab === 'settings' && <SettingsTab profile={profile} onProfileChange={onProfileChange} />}
      </div>
    </div>
  )
}
