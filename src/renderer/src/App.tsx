import { useEffect, useState } from 'react'
import type { ServerProfile } from '@shared/types'
import Dashboard from './pages/Dashboard'
import ServerDetail, { type TabKey } from './pages/ServerDetail'
import SteamCmdView from './pages/SteamCmdView'
import DataSettingsView from './pages/DataSettingsView'
import ProfileManagementView from './pages/ProfileManagementView'

export default function App(): JSX.Element {
  const [profiles, setProfiles] = useState<ServerProfile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [initialTab, setInitialTab] = useState<TabKey | undefined>(undefined)
  const [showSteamCmd, setShowSteamCmd] = useState(false)
  const [showDataSettings, setShowDataSettings] = useState(false)
  const [showProfileManagement, setShowProfileManagement] = useState(false)
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

  return selected ? (
    <ServerDetail
      profile={selected}
      initialTab={initialTab}
      onBack={() => setSelectedId(null)}
      onProfileChange={handleProfileChange}
    />
  ) : (
    <Dashboard
      profiles={profiles}
      onProfilesChange={handleProfilesChange}
      onOpenProfile={handleOpenProfile}
      onOpenSteamCmd={() => setShowSteamCmd(true)}
      onOpenDataSettings={() => setShowDataSettings(true)}
      onOpenProfileManagement={() => setShowProfileManagement(true)}
    />
  )
}
