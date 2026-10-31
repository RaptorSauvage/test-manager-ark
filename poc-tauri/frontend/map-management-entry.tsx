/**
 * Mounts the REAL, completely unmodified src/renderer/src/pages/ServerDetail/MapManagementTab.tsx
 * - a ninth real page, and the first in a few rounds with no push event to wire: real, unmodified
 * lib/mapManagement.ts's listMapFolders/createMapFolder/deleteMapFolder/openMapFolder, a plain
 * request/response CRUD over a server's SavedArks subfolders, no live update anywhere in it.
 * create/delete both mirror the same real `void` return shape that bit backup.delete/
 * backup.restore in "A seventh real page" - wrapped in a concrete `{ ok: true }` in sidecar.ts
 * from the start this time, not rediscovered the hard way a third time.
 */
import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import MapManagementTab from '../../src/renderer/src/pages/ServerDetail/MapManagementTab'
import { wrapInvoke } from './lib/tauriInvoke'
import type { MapFolderEntry, ServerProfile } from '../../shared/types'

declare global {
  interface Window {
    __TAURI__: {
      core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
    }
    api: {
      system: {
        focusWindow: () => Promise<void>
      }
      mapManagement: {
        list: (profileId: string) => Promise<MapFolderEntry[]>
        create: (profileId: string, folderName: string, fileName: string) => Promise<void>
        delete: (profileId: string, folderName: string) => Promise<void>
        openFolder: (profileId: string, folderName: string) => Promise<void>
      }
    }
  }
}

const invoke = wrapInvoke(window.__TAURI__.core.invoke)

// MapManagementTab itself doesn't call window.api.system.focusWindow, but its own
// confirmAction() import does (the "Delete the ... map folder" confirm) - same real
// lib/confirmAction.ts every destructive-action page in this PoC already shims this for.
window.api = {
  system: {
    focusWindow: () => invoke('window_focus') as Promise<void>
  },
  mapManagement: {
    list: (profileId) => invoke('map_management_list', { profileId }) as Promise<MapFolderEntry[]>,
    create: (profileId, folderName, fileName) =>
      invoke('map_management_create', { profileId, folderName, fileName }) as Promise<void>,
    delete: (profileId, folderName) => invoke('map_management_delete', { profileId, folderName }) as Promise<void>,
    openFolder: (profileId, folderName) =>
      invoke('map_management_open_folder', { profileId, folderName }) as Promise<void>
  }
}

function MapManagementPage(): JSX.Element | null {
  const [profile, setProfile] = useState<ServerProfile | null>(null)

  useEffect(() => {
    invoke('profiles_list').then((result) => {
      const profiles = result as ServerProfile[]
      const requestedId = new URLSearchParams(window.location.search).get('profile')
      setProfile(profiles.find((p) => p.id === requestedId) ?? profiles[0] ?? null)
    })
  }, [])

  if (!profile) return null

  return <MapManagementTab profile={profile} />
}

const container = document.getElementById('root')
if (!container) throw new Error('map-management.html is missing #root')
createRoot(container).render(<MapManagementPage />)
