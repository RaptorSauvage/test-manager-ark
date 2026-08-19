import { useEffect, useState } from 'react'
import type { ServerProfile } from '@shared/types'
import Dashboard from './pages/Dashboard'
import ClusterDataView from './pages/ClusterDataView'
import GroupConsoleView from './pages/GroupConsoleView'
import ServerDetail, { type TabKey } from './pages/ServerDetail'
import SteamCmdView from './pages/SteamCmdView'
import DataSettingsView from './pages/DataSettingsView'
import ProfileManagementView from './pages/ProfileManagementView'

type MainPage = 'dashboard' | 'clusterData'

export default function App(): JSX.Element {
  const [profiles, setProfiles] = useState<ServerProfile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [initialTab, setInitialTab] = useState<TabKey | undefined>(undefined)
  const [showSteamCmd, setShowSteamCmd] = useState(false)
  const [showDataSettings, setShowDataSettings] = useState(false)
  const [showProfileManagement, setShowProfileManagement] = useState(false)
  const [mainPage, setMainPage] = useState<MainPage>('dashboard')
  const [groupConsoleTarget, setGroupConsoleTarget] = useState<{ groupName: string; profileIds: string[] } | null>(
    null
  )
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    window.api.profiles.list().then((list) => {
      setProfiles(list)
      setLoaded(true)
    })
  }, [])

  if (!loaded) {
    return <div className="loading">Loading...</div>
  }

  const selected = profiles.find((p) => p.id === selectedId) ?? null

  function handleProfilesChange(updated: ServerProfile[]): void {
    setProfiles(updated)
    if (selectedId && !updated.find((p) => p.id === selectedId)) {
      setSelectedId(null)
    }
  }

  function handleProfileChange(updated: ServerProfile): void {
    setProfiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
  }

  function handleOpenProfile(id: string, tab?: TabKey): void {
    setSelectedId(id)
    setInitialTab(tab)
  }

  function handleOpenGroup(groupName: string, groupProfiles: ServerProfile[]): void {
    setGroupConsoleTarget({ groupName, profileIds: groupProfiles.map((p) => p.id) })
  }

  if (showSteamCmd) {
    return <SteamCmdView onBack={() => setShowSteamCmd(false)} />
  }

  if (showDataSettings) {
    return <DataSettingsView onBack={() => setShowDataSettings(false)} />
  }

  if (showProfileManagement) {
    return (
      <ProfileManagementView
        profiles={profiles}
        onProfilesChange={handleProfilesChange}
        onBack={() => setShowProfileManagement(false)}
      />
    )
  }

  if (selected) {
    return (
      <ServerDetail
        profile={selected}
        initialTab={initialTab}
        onBack={() => setSelectedId(null)}
        onProfileChange={handleProfileChange}
      />
    )
  }

  if (groupConsoleTarget) {
    const groupProfiles = profiles.filter((p) => groupConsoleTarget.profileIds.includes(p.id))
    return (
      <GroupConsoleView
        groupName={groupConsoleTarget.groupName}
        profiles={groupProfiles}
        onBack={() => setGroupConsoleTarget(null)}
      />
    )
  }

  return (
    <div className="app-shell">
      <nav className="app-sidebar">
        <button
          type="button"
          className={mainPage === 'dashboard' ? 'active' : ''}
          onClick={() => setMainPage('dashboard')}
        >
          Dashboard
        </button>
        <button
          type="button"
          className={mainPage === 'clusterData' ? 'active' : ''}
          onClick={() => setMainPage('clusterData')}
        >
          Cluster Data
        </button>
      </nav>
      <div className="app-content">
        {mainPage === 'clusterData' ? (
          <ClusterDataView profiles={profiles} onOpenGroup={handleOpenGroup} />
        ) : (
          <Dashboard
            profiles={profiles}
            onProfilesChange={handleProfilesChange}
            onOpenProfile={handleOpenProfile}
            onOpenSteamCmd={() => setShowSteamCmd(true)}
            onOpenDataSettings={() => setShowDataSettings(true)}
            onOpenProfileManagement={() => setShowProfileManagement(true)}
          />
        )}
      </div>
    </div>
  )
}
