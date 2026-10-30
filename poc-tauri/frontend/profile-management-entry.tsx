/**
 * Mounts the REAL, completely unmodified src/renderer/src/pages/ProfileManagementView.tsx -
 * the second real UI page this PoC proves, after ManagerLogView (read-only). This one is a
 * write path with a native OS dialog in front of it: window.api.dialog.selectDirectory() has
 * no sidecar involvement at all (see main.rs's dialog_select_directory - the real dialog.ts is
 * a main-process/window-level concern in Electron too, not a lib/*.ts function), while
 * window.api.profiles.copy/move round-trip through the sidecar to the real, unmodified
 * copyProfile()/moveProfile() (lib/profileCopyMove.ts) exactly like profiles.list/save already
 * do for reads. A thin ProfileManagementPage wrapper owns the `profiles` list state the real
 * component expects as a prop (in the real app, App.tsx owns this) - everything inside
 * ProfileManagementView itself is untouched production code.
 */
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ProfileManagementView from '../../src/renderer/src/pages/ProfileManagementView'
import { wrapInvoke } from './lib/tauriInvoke'
import type { ServerProfile } from '../../shared/types'

declare global {
  interface Window {
    __TAURI__: {
      core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
    }
    api: {
      dialog: {
        selectDirectory: () => Promise<string | null>
      }
      profiles: {
        copy: (
          profileId: string,
          destInstallDir: string,
          newName: string
        ) => Promise<{ profile: ServerProfile; profiles: ServerProfile[] }>
        move: (
          profileId: string,
          destInstallDir: string,
          newName: string
        ) => Promise<{ profile: ServerProfile; profiles: ServerProfile[] }>
      }
    }
  }
}

const invoke = wrapInvoke(window.__TAURI__.core.invoke)

// Same shape as every other real call in this PoC: a thin invoke() wrapper, no logic of its
// own. dialog.selectDirectory resolves straight to Rust (no "method" to a sidecar at all);
// profiles.copy/move go through the sidecar, same as profiles.list/save.
window.api = {
  dialog: {
    selectDirectory: () => invoke('dialog_select_directory') as Promise<string | null>
  },
  profiles: {
    copy: (profileId, destInstallDir, newName) =>
      invoke('profiles_copy', { profileId, destInstallDir, newName }) as Promise<{
        profile: ServerProfile
        profiles: ServerProfile[]
      }>,
    move: (profileId, destInstallDir, newName) =>
      invoke('profiles_move', { profileId, destInstallDir, newName }) as Promise<{
        profile: ServerProfile
        profiles: ServerProfile[]
      }>
  }
}

function ProfileManagementPage(): JSX.Element | null {
  const [profiles, setProfiles] = useState<ServerProfile[] | null>(null)

  useEffect(() => {
    invoke('profiles_list').then((result) => setProfiles(result as ServerProfile[]))
  }, [])

  // The real App.tsx only ever mounts ProfileManagementView once its own app-wide `profiles`
  // state is already loaded (it's loaded earlier, at startup) - never with an empty array that
  // fills in later. ProfileManagementView's own `selectedId` state is seeded from `profiles[0]`
  // only once, at mount (plain useState, not derived every render), so mounting it here before
  // the real invoke('profiles_list') round trip resolves would seed selectedId from an empty
  // list and never pick it up once real profiles arrive - a wrapper-only bug (not in the real
  // component) that showed up as the dropdown's real options but no "Current install folder" /
  // copy-or-move controls below it. Waiting for the fetch first, like App.tsx already does,
  // matches the real mount order instead of working around it.
  if (profiles === null) return null

  return (
    <ProfileManagementView
      profiles={profiles}
      onProfilesChange={setProfiles}
      onBack={() => window.history.back()}
    />
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('profile-management.html is missing #root')
createRoot(container).render(<ProfileManagementPage />)
