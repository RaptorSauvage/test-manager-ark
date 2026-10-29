import { useState } from 'react'
import type { ServerProfile } from '@shared/types'
import AnalyticsTab from './AnalyticsTab'
import ModsTab from './ModsTab'
import BackupsTab from './BackupsTab'
import SettingsTab from './SettingsTab'
import ServerManagementTab from './ServerManagementTab'
import MapManagementTab from './MapManagementTab'
import UpdateLogTab from './UpdateLogTab'
import FilesTab from './FilesTab'

export type TabKey = 'analytics' | 'mods' | 'backups' | 'management' | 'mapManagement' | 'files' | 'updateLog' | 'settings'

interface ServerDetailProps {
  profile: ServerProfile
  initialTab?: TabKey
  onBack: () => void
  onProfileChange: (profile: ServerProfile) => void
}

export interface ServerDetailTabMeta {
  key: TabKey
  label: string
  icon: string
  group: 'Overview' | 'Configuration' | 'Maintenance' | 'Files'
}

// Exported so the Dashboard's own card "..." menu can list these same tabs directly (each
// jumping straight to that tab) instead of a single generic "Manage" entry - one source of
// truth for the key/label/icon/group of every tab, read here for the left nav below and
// there for the dropdown.
export const SERVER_DETAIL_TABS: ServerDetailTabMeta[] = [
  { key: 'analytics', label: 'Analytics', icon: '📊', group: 'Overview' },
  { key: 'settings', label: 'Settings', icon: '⚙️', group: 'Configuration' },
  { key: 'mods', label: 'Mods', icon: '🧩', group: 'Configuration' },
  { key: 'mapManagement', label: 'Map Management', icon: '🗺️', group: 'Configuration' },
  { key: 'backups', label: 'Backups', icon: '💾', group: 'Maintenance' },
  { key: 'updateLog', label: 'Update Log', icon: '📜', group: 'Maintenance' },
  { key: 'management', label: 'Server Management', icon: '🛠️', group: 'Maintenance' },
  { key: 'files', label: 'Files', icon: '📁', group: 'Files' }
]

const SERVER_DETAIL_TAB_GROUPS: ServerDetailTabMeta['group'][] = ['Overview', 'Configuration', 'Maintenance', 'Files']

export default function ServerDetail({ profile, initialTab, onBack, onProfileChange }: ServerDetailProps): JSX.Element {
  const [tab, setTab] = useState<TabKey>(initialTab ?? 'analytics')
  const activeTabMeta = SERVER_DETAIL_TABS.find((t) => t.key === tab) ?? SERVER_DETAIL_TABS[0]

  return (
    <div className="server-detail settings-view">
      <header className="server-detail-header">
        <button onClick={onBack}>&larr; Back</button>
        <h1>{profile.name}</h1>
      </header>

      <div className="settings-shell">
        <nav className="settings-nav">
          {SERVER_DETAIL_TAB_GROUPS.map((group) => (
            <div className="settings-nav-group" key={group}>
              <div className="settings-nav-group-label">{group.toUpperCase()}</div>
              {SERVER_DETAIL_TABS.filter((t) => t.group === group).map((t) => (
                <button key={t.key} type="button" className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
                  <span className="settings-nav-icon">{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="settings-content">
          <div className="settings-content-header">
            <h2>
              <span className="settings-nav-icon">{activeTabMeta.icon}</span>
              {activeTabMeta.label}
            </h2>
          </div>
          {tab === 'analytics' && <AnalyticsTab profile={profile} onProfileChange={onProfileChange} />}
          {tab === 'mods' && <ModsTab profile={profile} onProfileChange={onProfileChange} />}
          {tab === 'backups' && <BackupsTab profile={profile} onProfileChange={onProfileChange} />}
          {tab === 'management' && <ServerManagementTab profile={profile} onProfileChange={onProfileChange} />}
          {tab === 'mapManagement' && <MapManagementTab profile={profile} />}
          {tab === 'files' && <FilesTab profile={profile} />}
          {tab === 'updateLog' && <UpdateLogTab profile={profile} />}
          {tab === 'settings' && <SettingsTab profile={profile} onProfileChange={onProfileChange} />}
        </div>
      </div>
    </div>
  )
}
