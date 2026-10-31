/**
 * Mounts the REAL, completely unmodified src/renderer/src/pages/ServerDetail/ServerManagementTab.tsx
 * - a tenth real page, and mostly a big settings form: every one of its many checkboxes/inputs
 * (startOnManagerLaunch, crashWatchEnabled, zombieDetection*, scheduledRestart*,
 * scheduledDinoWipe*, scheduledMaintenance*, scheduledRconCommands, ...) persists straight
 * through the real, already-proven window.api.profiles.save - no new real-code surface for any
 * of that. Also mounts the real, unmodified ScheduleDaysPicker.tsx (its own live "next
 * occurrence" countdown, @shared/scheduleTime's computeNextOccurrence/formatCountdown) with zero
 * window.api involvement at all - pure client-side date math.
 *
 * The one genuinely new real call: a scheduled RCON command entry's "Run now" button, backed by
 * window.api.groupConsole.sendRcon - which turns out (see ipc/groupConsole.ts) to be a thin
 * wrapper around the exact same real sendRconCommand() player_roster_kick/player_bans_ban
 * already proved in "A third real page", not a new RCON code path.
 */
import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import ServerManagementTab from '../../src/renderer/src/pages/ServerDetail/ServerManagementTab'
import { wrapInvoke } from './lib/tauriInvoke'
import type { ServerProfile } from '../../shared/types'

declare global {
  interface Window {
    __TAURI__: {
      core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
    }
    api: {
      profiles: {
        save: (profile: ServerProfile) => Promise<ServerProfile[]>
      }
      groupConsole: {
        sendRcon: (profileId: string, command: string) => Promise<{ ok: boolean; response?: string; error?: string }>
      }
    }
  }
}

const invoke = wrapInvoke(window.__TAURI__.core.invoke)

window.api = {
  profiles: {
    save: (profile) => invoke('profiles_save', { profile }) as Promise<ServerProfile[]>
  },
  groupConsole: {
    sendRcon: (profileId, command) =>
      invoke('group_console_rcon_send', { profileId, command }) as Promise<{
        ok: boolean
        response?: string
        error?: string
      }>
  }
}

function ServerManagementPage(): JSX.Element | null {
  const [profile, setProfile] = useState<ServerProfile | null>(null)

  useEffect(() => {
    invoke('profiles_list').then((result) => {
      const profiles = result as ServerProfile[]
      const requestedId = new URLSearchParams(window.location.search).get('profile')
      setProfile(profiles.find((p) => p.id === requestedId) ?? profiles[0] ?? null)
    })
  }, [])

  if (!profile) return null

  return <ServerManagementTab profile={profile} onProfileChange={setProfile} />
}

const container = document.getElementById('root')
if (!container) throw new Error('server-management.html is missing #root')
createRoot(container).render(<ServerManagementPage />)
