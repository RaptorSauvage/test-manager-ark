/**
 * Mounts the REAL, completely unmodified src/renderer/src/pages/ServerDetail/BackupsTab.tsx -
 * a seventh real page, and the heaviest write path this PoC has proven yet. BackupsTab itself
 * mounts two more real, unmodified child components (PlayerBackupsSection.tsx,
 * BackupLogPanel.tsx) and a real hook (useServerStatuses.ts, imported here unmodified too, for
 * the "stop the server before restoring" gate) - none of those have their own entry file, they
 * just call the same window.api.backup / window.api.playerBackup methods BackupsTab itself calls.
 *
 * What's genuinely new versus every earlier round: createBackup() sends a real RCON
 * `SaveWorld`, waits a real 40s settle, then zips real files off disk with `archiver`;
 * restoreBackup() extracts a real zip straight over SavedArks with `adm-zip`. Both are real
 * lib/backup.ts code, unmodified - standalone testing (see README) uses the same stand-in
 * server script server.installTestExecutable already proved, pointed at a small SavedArks
 * fixture, so there's something real on disk to zip/restore without a real ARK binary.
 */
import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import BackupsTab from '../../src/renderer/src/pages/ServerDetail/BackupsTab'
import { wrapInvoke } from './lib/tauriInvoke'
import type { BackupEntry, BackupLogEntry, PlayerBackupFolder, ServerProfile, ServerStatus } from '../../shared/types'

declare global {
  interface Window {
    __TAURI__: {
      core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
      event: {
        listen: (
          event: string,
          handler: (event: { payload: unknown }) => void
        ) => Promise<() => void>
      }
    }
    api: {
      system: {
        focusWindow: () => Promise<void>
      }
      profiles: {
        save: (profile: ServerProfile) => Promise<ServerProfile[]>
      }
      dialog: {
        selectDirectory: () => Promise<string | null>
      }
      server: {
        status: (profileId: string) => Promise<ServerStatus>
        onStatusChanged: (callback: (status: ServerStatus) => void) => () => void
      }
      backup: {
        create: (profileId: string) => Promise<BackupEntry>
        list: (profileId: string) => Promise<BackupEntry[]>
        delete: (filePath: string) => Promise<void>
        restore: (profileId: string, filePath: string) => Promise<void>
        openFolder: (profileId: string) => Promise<void>
        onCreated: (callback: (profileId: string) => void) => () => void
        getLog: (profileId: string) => Promise<BackupLogEntry[]>
        onLogChanged: (callback: (profileId: string, entry: BackupLogEntry) => void) => () => void
      }
      playerBackup: {
        listFolders: (profileId: string) => Promise<PlayerBackupFolder[]>
        list: (profileId: string, folderKey: string) => Promise<BackupEntry[]>
        openFolder: (profileId: string, folderKey: string) => Promise<void>
      }
    }
  }
}

const invoke = wrapInvoke(window.__TAURI__.core.invoke)
const { listen } = window.__TAURI__.event

// Same "listen, buffer cancellation, return an unlisten fn" shape as every other push-backed
// window.api method in this PoC (manager-log-entry, server-status, console-line, ...) - see
// manager-log-entry.tsx's own comment on why the cancelled/unlistenFn dance is needed (listen()
// resolves asynchronously, after a caller may have already unmounted).
function onEvent<T>(event: string, callback: (payload: T) => void): () => void {
  let unlistenFn: (() => void) | null = null
  let cancelled = false
  listen(event, (e) => callback(e.payload as T)).then((unlisten) => {
    if (cancelled) unlisten()
    else unlistenFn = unlisten
  })
  return () => {
    cancelled = true
    unlistenFn?.()
  }
}

window.api = {
  system: {
    focusWindow: () => invoke('window_focus') as Promise<void>
  },
  profiles: {
    save: (profile) => invoke('profiles_save', { profile }) as Promise<ServerProfile[]>
  },
  dialog: {
    selectDirectory: () => invoke('dialog_select_directory') as Promise<string | null>
  },
  server: {
    status: (profileId) => invoke('server_status', { profileId }) as Promise<ServerStatus>,
    onStatusChanged: (callback) => onEvent('server-status', callback)
  },
  backup: {
    create: (profileId) => invoke('backup_create', { profileId }) as Promise<BackupEntry>,
    list: (profileId) => invoke('backup_list', { profileId }) as Promise<BackupEntry[]>,
    delete: (filePath) => invoke('backup_delete', { filePath }) as Promise<void>,
    restore: (profileId, filePath) => invoke('backup_restore', { profileId, filePath }) as Promise<void>,
    openFolder: (profileId) => invoke('backup_open_folder', { profileId }) as Promise<void>,
    onCreated: (callback) => onEvent<string>('backup-created', callback),
    getLog: (profileId) => invoke('backup_get_log', { profileId }) as Promise<BackupLogEntry[]>,
    onLogChanged: (callback) =>
      onEvent<{ profileId: string; entry: BackupLogEntry }>('backup-log-entry', ({ profileId, entry }) =>
        callback(profileId, entry)
      )
  },
  playerBackup: {
    listFolders: (profileId) => invoke('player_backup_list_folders', { profileId }) as Promise<PlayerBackupFolder[]>,
    list: (profileId, folderKey) =>
      invoke('player_backup_list', { profileId, folderKey }) as Promise<BackupEntry[]>,
    openFolder: (profileId, folderKey) =>
      invoke('player_backup_open_folder', { profileId, folderKey }) as Promise<void>
  }
}

function BackupsPage(): JSX.Element | null {
  const [profile, setProfile] = useState<ServerProfile | null>(null)

  useEffect(() => {
    invoke('profiles_list').then((result) => {
      const profiles = result as ServerProfile[]
      const requestedId = new URLSearchParams(window.location.search).get('profile')
      setProfile(profiles.find((p) => p.id === requestedId) ?? profiles[0] ?? null)
    })
  }, [])

  if (!profile) return null

  return <BackupsTab profile={profile} onProfileChange={setProfile} />
}

const container = document.getElementById('root')
if (!container) throw new Error('backups.html is missing #root')
createRoot(container).render(<BackupsPage />)
