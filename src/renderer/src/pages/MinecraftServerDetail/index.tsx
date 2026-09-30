import { useState } from 'react'
import type { MinecraftProfile } from '@shared/minecraft'
import ConsoleTab from './ConsoleTab'
import SettingsTab from './SettingsTab'

export type MinecraftTabKey = 'console' | 'settings'

interface MinecraftServerDetailProps {
  profile: MinecraftProfile
  initialTab?: MinecraftTabKey
  onBack: () => void
  onProfileChange: (profile: MinecraftProfile) => void
}

const TABS: Array<{ key: MinecraftTabKey; label: string }> = [
  { key: 'console', label: 'Console' },
  { key: 'settings', label: 'Settings' }
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
        {tab === 'settings' && <SettingsTab profile={profile} onProfileChange={onProfileChange} />}
      </div>
    </div>
  )
}
