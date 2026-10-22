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
import ChangelogView from './pages/ChangelogView'
import PlayersView from './pages/PlayersView'
import ProfileManagementView from './pages/ProfileManagementView'
import MinecraftDashboard from './pages/MinecraftDashboard'
import MinecraftServerDetail, { type MinecraftTabKey } from './pages/MinecraftServerDetail'
import { GAME_ICONS } from './lib/gameIcons'
import minecraftIcon from './assets/games/minecraft.png'
import TitleBar from './components/TitleBar'
import dashboardIcon from './assets/icons/dashboard.png'
import clusterIcon from './assets/icons/cluster.png'
import playersIcon from './assets/icons/players.png'
import settingsIcon from './assets/icons/settings.png'
import logIcon from './assets/icons/log.png'

type MainPage = 'dashboard' | 'clusterData' | 'players' | 'managerLog'
type GameMode = 'ark' | 'minecraft'

/** A sidebar nav button's leading icon - either a line-art image (masked into the current
 *  text color, same technique as the Update button's shield icon) for the ones the user
 *  supplied real artwork for, or a plain emoji glyph for the rest, matching how the app
 *  already mixes both elsewhere (card action icons vs. the title bar's bell/grid). */
function SidebarIcon({ mask, emoji }: { mask?: string; emoji?: string }): JSX.Element {
  if (mask) {
    return (
      <span className="sidebar-icon icon-mask" style={{ WebkitMaskImage: `url("${mask}")`, maskImage: `url("${mask}")` }} />
    )
  }
  return <span className="sidebar-icon">{emoji}</span>
}

/** The ARK/Minecraft switch - its own small group at the top of the sidebar, visually
 *  separate (a divider below it) from whatever page nav follows, since it toggles the
 *  entire app's mode rather than navigating within it. */
function GameSwitch({ mode, onChange }: { mode: GameMode; onChange: (mode: GameMode) => void }): JSX.Element {
  return (
    <div className="app-sidebar-game-switch">
      <button
        type="button"
        className={mode === 'ark' ? 'active' : ''}
        onClick={() => onChange('ark')}
        title="ARK: Survival Evolved / Ascended"
      >
        <img src={GAME_ICONS['ark-evolved.png']} alt="ARK" />
      </button>
      <button
        type="button"
        className={mode === 'minecraft' ? 'active' : ''}
        onClick={() => onChange('minecraft')}
        title="Minecraft"
      >
        <img src={minecraftIcon} alt="Minecraft" />
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
  const [showChangelog, setShowChangelog] = useState(false)
  const [showCreateWizard, setShowCreateWizard] = useState(false)
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

  // Settings/SteamCMD/Profile Management/Changelog are all checked ahead of the "selected
  // server"/"group console" branches below, so just setting their flags from the title bar
  // already takes over the view regardless of what's currently showing - no extra resetting
  // needed. "Manager Log" is different: it's a mainPage *inside* the default shell branch,
  // which is checked last, so reaching it from somewhere like a server's own detail view also
  // needs that other view's own state cleared first, or the earlier branch would still win.
  function handleOpenManagerLog(): void {
    setSelectedId(null)
    setMinecraftSelectedId(null)
    setGroupConsoleTarget(null)
    setShowSteamCmd(false)
    setShowDataSettings(false)
    setShowProfileManagement(false)
    setShowChangelog(false)
    setMainPage('managerLog')
  }

  // Same reasoning as handleOpenManagerLog above - the wizard only renders inside Dashboard's
  // own JSX, which only mounts for the default ARK shell branch, so reaching it from anywhere
  // else needs every other view's state cleared first.
  function handleOpenCreateWizard(): void {
    setSelectedId(null)
    setMinecraftSelectedId(null)
    setGroupConsoleTarget(null)
    setShowSteamCmd(false)
    setShowDataSettings(false)
    setShowProfileManagement(false)
    setShowChangelog(false)
    setGameMode('ark')
    setMainPage('dashboard')
    setShowCreateWizard(true)
  }

  const titleBar = (
    <TitleBar
      onOpenSettings={() => setShowDataSettings(true)}
      onOpenSteamCmd={() => setShowSteamCmd(true)}
      onOpenProfileManagement={() => setShowProfileManagement(true)}
      onOpenManagerLog={handleOpenManagerLog}
      onOpenChangelog={() => setShowChangelog(true)}
      onOpenCreateWizard={handleOpenCreateWizard}
    />
  )

  if (!loaded || !minecraftLoaded) {
    return (
      <>
        {titleBar}
        <div className="loading">Loading...</div>
      </>
    )
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

  // Checked before the ARK/Minecraft split below - these are top-level screens reachable
  // from either game mode (most importantly Settings, which used to live only in the ARK
  // Dashboard's own header and so was unreachable while in Minecraft mode entirely).
  if (showSteamCmd) {
    return (
      <>
        {titleBar}
        <SteamCmdView onBack={() => setShowSteamCmd(false)} />
      </>
    )
  }

  if (showDataSettings) {
    return (
      <>
        {titleBar}
        <DataSettingsView onBack={() => setShowDataSettings(false)} />
      </>
    )
  }

  if (showProfileManagement) {
    return (
      <>
        {titleBar}
        <ProfileManagementView
          profiles={profiles}
          onProfilesChange={handleProfilesChange}
          onBack={() => setShowProfileManagement(false)}
        />
      </>
    )
  }

  if (showChangelog) {
    return (
      <>
        {titleBar}
        <ChangelogView onBack={() => setShowChangelog(false)} />
      </>
    )
  }

  if (gameMode === 'minecraft') {
    if (minecraftSelected) {
      return (
        <>
          {titleBar}
          <MinecraftServerDetail
            profile={minecraftSelected}
            initialTab={minecraftInitialTab}
            onBack={() => setMinecraftSelectedId(null)}
            onProfileChange={handleMinecraftProfileChange}
          />
        </>
      )
    }

    return (
      <>
        {titleBar}
        <div className="app-shell">
          <nav className="app-sidebar">
            <GameSwitch mode={gameMode} onChange={setGameMode} />
            <button
              type="button"
              className={mainPage !== 'managerLog' ? 'active' : ''}
              onClick={() => setMainPage('dashboard')}
              title="Minecraft Servers"
            >
              <SidebarIcon mask={dashboardIcon} />
            </button>
            <button
              type="button"
              className="app-sidebar-bottom-group"
              onClick={() => setShowChangelog(true)}
              title="What's New"
            >
              <SidebarIcon emoji="🔔" />
            </button>
            <button
              type="button"
              className={mainPage === 'managerLog' ? 'active' : ''}
              onClick={() => setMainPage('managerLog')}
              title="Log"
            >
              <SidebarIcon mask={logIcon} />
            </button>
            <button type="button" onClick={() => setShowDataSettings(true)} title="Settings">
              <SidebarIcon mask={settingsIcon} />
            </button>
          </nav>
          <div className="app-content">
            {mainPage === 'managerLog' ? (
              <ManagerLogView />
            ) : (
              <MinecraftDashboard
                profiles={minecraftProfiles}
                onProfilesChange={handleMinecraftProfilesChange}
                onOpenProfile={handleOpenMinecraftProfile}
              />
            )}
          </div>
        </div>
      </>
    )
  }

  if (selected) {
    return (
      <>
        {titleBar}
        <ServerDetail
          profile={selected}
          initialTab={initialTab}
          onBack={() => setSelectedId(null)}
          onProfileChange={handleProfileChange}
        />
      </>
    )
  }

  if (groupConsoleTarget) {
    const groupProfiles = profiles.filter((p) => groupConsoleTarget.profileIds.includes(p.id))
    return (
      <>
        {titleBar}
        <GroupConsoleView
          groupName={groupConsoleTarget.groupName}
          profiles={groupProfiles}
          onBack={() => setGroupConsoleTarget(null)}
          onOpenProfile={handleOpenProfile}
        />
      </>
    )
  }

  return (
    <>
      {titleBar}
      <div className="app-shell">
        <nav className="app-sidebar">
          <GameSwitch mode={gameMode} onChange={setGameMode} />
          <button
            type="button"
            className={mainPage === 'dashboard' ? 'active' : ''}
            onClick={() => setMainPage('dashboard')}
            title="Dashboard"
          >
            <SidebarIcon mask={dashboardIcon} />
          </button>
          <button
            type="button"
            className={mainPage === 'clusterData' ? 'active' : ''}
            onClick={() => setMainPage('clusterData')}
            title="Cluster Dashboard"
          >
            <SidebarIcon mask={clusterIcon} />
          </button>
          <button
            type="button"
            className={mainPage === 'players' ? 'active' : ''}
            onClick={() => setMainPage('players')}
            title="Players"
          >
            <SidebarIcon mask={playersIcon} />
          </button>
          <button
            type="button"
            className="app-sidebar-bottom-group"
            onClick={() => setShowChangelog(true)}
            title="What's New"
          >
            <SidebarIcon emoji="🔔" />
          </button>
          <button
            type="button"
            className={mainPage === 'managerLog' ? 'active' : ''}
            onClick={() => setMainPage('managerLog')}
            title="Log"
          >
            <SidebarIcon mask={logIcon} />
          </button>
          <button type="button" onClick={() => setShowDataSettings(true)} title="Settings">
            <SidebarIcon mask={settingsIcon} />
          </button>
        </nav>
        <div className="app-content">
          {mainPage === 'clusterData' ? (
            <ClusterDataView profiles={profiles} onOpenGroup={handleOpenGroup} />
          ) : mainPage === 'players' ? (
            <PlayersView profiles={profiles} />
          ) : mainPage === 'managerLog' ? (
            <ManagerLogView />
          ) : (
            <Dashboard
              profiles={profiles}
              onProfilesChange={handleProfilesChange}
              onOpenProfile={handleOpenProfile}
              showCreateWizard={showCreateWizard}
              onOpenCreateWizard={() => setShowCreateWizard(true)}
              onCloseCreateWizard={() => setShowCreateWizard(false)}
            />
          )}
        </div>
      </div>
    </>
  )
}
