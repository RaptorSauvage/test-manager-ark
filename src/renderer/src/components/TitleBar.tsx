import { useEffect, useState } from 'react'

type MenuKey = 'file' | 'tools' | 'help' | null

interface TitleBarProps {
  onOpenSettings: () => void
  onOpenSteamCmd: () => void
  onOpenProfileManagement: () => void
  onOpenMapManager: () => void
  onOpenManageGroups: () => void
  onOpenEventScheduler: () => void
  onOpenIniTemplates: () => void
  onOpenManagerLog: () => void
  onOpenChangelog: () => void
  onOpenCreateWizard: () => void
}

/** Custom-drawn title bar replacing the OS one (the window runs frame: false - see
 *  createWindow in main/index.ts) - File/Tools/Help menus on the left (the app's own
 *  Menu.setApplicationMenu(null) removed the native one, so these are built from scratch,
 *  not relying on Electron's Menu), the app name centered, and the window's own
 *  minimize/maximize/close on the right since the OS no longer draws them. */
export default function TitleBar({
  onOpenSettings,
  onOpenSteamCmd,
  onOpenProfileManagement,
  onOpenMapManager,
  onOpenManageGroups,
  onOpenEventScheduler,
  onOpenIniTemplates,
  onOpenManagerLog,
  onOpenChangelog,
  onOpenCreateWizard
}: TitleBarProps): JSX.Element {
  const [openMenu, setOpenMenu] = useState<MenuKey>(null)
  const [isMaximized, setIsMaximized] = useState(false)
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    window.api.windowControls.isMaximized().then(setIsMaximized)
    return window.api.windowControls.onMaximizedChange(setIsMaximized)
  }, [])

  useEffect(() => {
    window.api.appUpdate.getVersion().then(setAppVersion)
  }, [])

  // Same click-outside-closes pattern as Dashboard's own card "..." dropdown - each trigger
  // button stops the click from reaching here via stopPropagation, so only a click genuinely
  // outside any menu closes it.
  useEffect(() => {
    if (!openMenu) return
    const close = (): void => setOpenMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openMenu])

  function toggleMenu(menu: Exclude<MenuKey, null>, e: React.MouseEvent): void {
    e.stopPropagation()
    setOpenMenu((prev) => (prev === menu ? null : menu))
  }

  function runAndClose(action: () => void): void {
    setOpenMenu(null)
    action()
  }

  return (
    <div className="title-bar">
      <div className="title-bar-left">
        <div className="title-bar-menu">
          <button
            type="button"
            className={`title-bar-menu-trigger${openMenu === 'file' ? ' open' : ''}`}
            onClick={(e) => toggleMenu('file', e)}
          >
            File
          </button>
          {openMenu === 'file' && (
            <div className="title-bar-dropdown" onClick={(e) => e.stopPropagation()}>
              <button type="button" onClick={() => runAndClose(onOpenSettings)}>
                Settings
              </button>
              <button type="button" onClick={() => runAndClose(onOpenManageGroups)}>
                Manage Groups
              </button>
              <hr />
              <button type="button" onClick={() => runAndClose(() => void window.api.system.openProfilesFolder())}>
                Open Profiles Folder
              </button>
              <button type="button" onClick={() => runAndClose(() => void window.api.system.openDataDirFolder())}>
                Open Data Folder
              </button>
              <hr />
              <button type="button" onClick={() => runAndClose(() => void window.api.system.quit())}>
                Quit
              </button>
            </div>
          )}
        </div>

        <div className="title-bar-menu">
          <button
            type="button"
            className={`title-bar-menu-trigger${openMenu === 'tools' ? ' open' : ''}`}
            onClick={(e) => toggleMenu('tools', e)}
          >
            Tools
          </button>
          {openMenu === 'tools' && (
            <div className="title-bar-dropdown" onClick={(e) => e.stopPropagation()}>
              <button type="button" onClick={() => runAndClose(onOpenCreateWizard)}>
                Add Profile
              </button>
              <hr />
              <button type="button" onClick={() => runAndClose(onOpenSteamCmd)}>
                SteamCMD
              </button>
              <button type="button" onClick={() => runAndClose(onOpenProfileManagement)}>
                Profile Management
              </button>
              <button type="button" onClick={() => runAndClose(onOpenMapManager)}>
                Map Manager
              </button>
              <button type="button" onClick={() => runAndClose(onOpenEventScheduler)}>
                Event Scheduler
              </button>
              <button type="button" onClick={() => runAndClose(onOpenIniTemplates)}>
                INI Templates
              </button>
              <button type="button" onClick={() => runAndClose(onOpenManagerLog)}>
                Manager Log
              </button>
              <hr />
              <button type="button" onClick={() => runAndClose(() => void window.api.system.openDevTools())}>
                Developer Tools
              </button>
            </div>
          )}
        </div>

        <div className="title-bar-menu">
          <button
            type="button"
            className={`title-bar-menu-trigger${openMenu === 'help' ? ' open' : ''}`}
            onClick={(e) => toggleMenu('help', e)}
          >
            Help
          </button>
          {openMenu === 'help' && (
            <div className="title-bar-dropdown" onClick={(e) => e.stopPropagation()}>
              <button type="button" onClick={() => runAndClose(onOpenChangelog)}>
                What&apos;s New
              </button>
            </div>
          )}
        </div>

        {appVersion && <span className="title-bar-version-badge">v{appVersion}</span>}
      </div>

      <div className="title-bar-title">Bober Server Manager</div>

      <div className="title-bar-right">
        <button
          type="button"
          className="title-bar-icon-btn"
          title="What's New"
          onClick={() => runAndClose(onOpenChangelog)}
        >
          🔔
        </button>
        <button type="button" className="title-bar-icon-btn" title="More">
          ▦
        </button>
        <div className="title-bar-window-controls">
          <button type="button" title="Minimize" onClick={() => void window.api.windowControls.minimize()}>
            &#x2013;
          </button>
          <button
            type="button"
            title={isMaximized ? 'Restore' : 'Maximize'}
            onClick={() => void window.api.windowControls.toggleMaximize()}
          >
            {isMaximized ? '❐' : '□'}
          </button>
          <button type="button" className="close" title="Close" onClick={() => void window.api.windowControls.close()}>
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
