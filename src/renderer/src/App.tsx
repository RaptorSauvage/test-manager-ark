import { useEffect, useState } from 'react'
import type { ServerProfile } from '@shared/types'
import type { MinecraftProfile } from '@shared/minecraft'
import Dashboard from './pages/Dashboard'
import ClusterDataView from './pages/ClusterDataView'
import GroupConsoleView from './pages/GroupConsoleView'
import ManagerLogView from './pages/ManagerLogView'
import ServerDetail, { type TabKey } from './pages/ServerDetail'
import SteamCmdView from './pages/SteamCmdView'
import DataSettingsView from './pages/DataSettingsView'
import ProfileManagementView from './pages/ProfileManagementView'
import MinecraftDashboard from './pages/MinecraftDashboard'
import MinecraftServerDetail, { type MinecraftTabKey } from './pages/MinecraftServerDetail'

type MainPage = 'dashboard' | 'clusterData' | 'managerLog'
type GameMode = 'ark' | 'minecraft'

/** The ARK/Minecraft switch - its own small group at the top of the sidebar, visually
 *  separate (a divider below it) from whatever page nav follows, since it toggles the
 *  entire app's mode rather than navigating within it. */
function GameSwitch({ mode, onChange }: { mode: GameMode; onChange: (mode: GameMode) => void }): JSX.Element {
  return (
    <div className="app-sidebar-game-switch">
      <button type="button" className={mode === 'ark' ? 'active' : ''} onClick={() => onChange('ark')}>
        ARK
      </button>
      <button type="button" className={mode === 'minecraft' ? 'active' : ''} onClick={() => onChange('minecraft')}>
        MC
      </button>
    </div>
  )
}

export default function App(): JSX.Element {
  const [gameMode, setGameMode] = useState<GameMode>('ark')

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

  const [minecraftProfiles, setMinecraftProfiles] = useState<MinecraftProfile[]>([])
  const [minecraftSelectedId, setMinecraftSelectedId] = useState<string | null>(null)
  const [minecraftInitialTab, setMinecraftInitialTab] = useState<MinecraftTabKey | undefined>(undefined)
  const [minecraftLoaded, setMinecraftLoaded] = useState(false)

  useEffect(() => {
    window.api.profiles.list().then((list) => {
      setProfiles(list)
      setLoaded(true)
    })
  }, [])

  useEffect(() => {
    window.api.minecraft.profiles.list().then((list) => {
      setMinecraftProfiles(list)
      setMinecraftLoaded(true)
    })
  }, [])

  // Same reasoning as the ARK profiles.onChanged effect below - keeps this window's
  // Minecraft profile list live if it's ever changed from outside it.
  useEffect(() => {
    return window.api.minecraft.profiles.onChanged((updated) => {
      setMinecraftProfiles(updated)
      setMinecraftSelectedId((prev) => (prev && !updated.some((p) => p.id === prev) ? null : prev))
    })
  }, [])

  // Keeps this window's profile list live even when a change came from outside it - most
  // notably the web dashboard's own HTTP routes, which save profiles directly without going
  // through this window's IPC calls at all, so without this an edit made there would only
  // ever show up here after a restart. Uses the functional setSelectedId form rather than
  // reading selectedId directly, since this effect's closure is fixed at mount and a direct
  // read would go stale the moment a server is actually selected.
  useEffect(() => {
    return window.api.profiles.onChanged((updated) => {
      setProfiles(updated)
      setSelectedId((prev) => (prev && !updated.some((p) => p.id === prev) ? null : prev))
    })
  }, [])

  if (!loaded || !minecraftLoaded) {
    return <div className="loading">Loading...</div>
  }

  const selected = profiles.find((p) => p.id === selectedId) ?? null
  const minecraftSelected = minecraftProfiles.find((p) => p.id === minecraftSelectedId) ?? null

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

  function handleMinecraftProfilesChange(updated: MinecraftProfile[]): void {
    setMinecraftProfiles(updated)
    if (minecraftSelectedId && !updated.find((p) => p.id === minecraftSelectedId)) {
      setMinecraftSelectedId(null)
    }
  }

  function handleMinecraftProfileChange(updated: MinecraftProfile): void {
    setMinecraftProfiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
  }

  function handleOpenMinecraftProfile(id: string, tab?: MinecraftTabKey): void {
    setMinecraftSelectedId(id)
    setMinecraftInitialTab(tab)
  }

  if (gameMode === 'minecraft') {
    if (minecraftSelected) {
      return (
        <MinecraftServerDetail
          profile={minecraftSelected}
          initialTab={minecraftInitialTab}
          onBack={() => setMinecraftSelectedId(null)}
          onProfileChange={handleMinecraftProfileChange}
        />
      )
    }

    return (
      <div className="app-shell">
        <nav className="app-sidebar">
          <GameSwitch mode={gameMode} onChange={setGameMode} />
        </nav>
        <div className="app-content">
          <MinecraftDashboard
            profiles={minecraftProfiles}
            onProfilesChange={handleMinecraftProfilesChange}
            onOpenProfile={handleOpenMinecraftProfile}
          />
        </div>
      </div>
    )
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
        onOpenProfile={handleOpenProfile}
      />
    )
  }

  return (
    <div className="app-shell">
      <nav className="app-sidebar">
        <GameSwitch mode={gameMode} onChange={setGameMode} />
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
          Cluster Dashboard
        </button>
        <button
          type="button"
          className={mainPage === 'managerLog' ? 'active' : ''}
          onClick={() => setMainPage('managerLog')}
        >
          Log
        </button>
      </nav>
      <div className="app-content">
        {mainPage === 'clusterData' ? (
          <ClusterDataView profiles={profiles} onOpenGroup={handleOpenGroup} />
        ) : mainPage === 'managerLog' ? (
          <ManagerLogView />
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
