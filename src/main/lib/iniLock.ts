import fs from 'node:fs/promises'
import path from 'node:path'
import type { ServerProfile, ServerStatus } from '@shared/types'
import { serverEvents } from './serverProcess'
import { getProfile, getSettings } from '../store'
import { getServerConfigDir } from './systemFolders'

/** Delay between a server's running/stopped transition and actually toggling its config
 *  files' read-only attribute - gives the ARK process (and the OS's own file handle
 *  cleanup) a few seconds of margin around the transition instead of racing it. */
export const INI_LOCK_DELAY_MS = 5000

function configFilePaths(installDir: string): string[] {
  const dir = getServerConfigDir(installDir)
  return [path.join(dir, 'GameUserSettings.ini'), path.join(dir, 'Game.ini')]
}

/** Best-effort: a missing file (fresh install) isn't an error worth surfacing. */
export async function setConfigFilesReadOnly(installDir: string, readOnly: boolean): Promise<void> {
  for (const file of configFilePaths(installDir)) {
    try {
      await fs.chmod(file, readOnly ? 0o444 : 0o666)
    } catch {
      // Not fatal - see above.
    }
  }
}

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()

function cancelPending(profileId: string): void {
  const existing = pendingTimers.get(profileId)
  if (existing) {
    clearTimeout(existing)
    pendingTimers.delete(profileId)
  }
}

/**
 * Debounces a profile's read-only toggle by `delayMs`, cancelling whatever change was still
 * pending for that profile - so a quick stop-then-start (a restart) collapses into just the
 * final intended state instead of briefly unlocking the files mid-restart.
 */
export function scheduleConfigFilesReadOnly(
  profileId: string,
  installDir: string,
  readOnly: boolean,
  apply: (installDir: string, readOnly: boolean) => Promise<void> = setConfigFilesReadOnly,
  delayMs: number = INI_LOCK_DELAY_MS
): void {
  cancelPending(profileId)
  const timer = setTimeout(() => {
    pendingTimers.delete(profileId)
    void apply(installDir, readOnly)
  }, delayMs)
  pendingTimers.set(profileId, timer)
}

/**
 * Locks a server's GameUserSettings.ini/Game.ini read-only shortly after it starts, and
 * unlocks them shortly after it fully stops - edited with Notepad (or anything else that
 * respects the OS-level read-only attribute), this keeps someone from saving over a config
 * the running server itself is relying on. Nothing in this app ever writes these files while
 * a server is running, so there's no risk of the lock blocking a legitimate in-app write.
 * Does nothing at all when the feature is turned off in Settings (`AppSettings.iniLockEnabled`).
 */
export function handleStatusForIniLock(
  status: ServerStatus,
  lookupProfile: (id: string) => { id: string; installDir: string } | undefined = getProfile,
  schedule: (profileId: string, installDir: string, readOnly: boolean) => void = scheduleConfigFilesReadOnly,
  isEnabled: () => boolean = () => getSettings().iniLockEnabled
): void {
  if (status.state !== 'running' && status.state !== 'stopped') return
  if (!isEnabled()) return
  const profile = lookupProfile(status.profileId)
  if (!profile) return
  schedule(profile.id, profile.installDir, status.state === 'running')
}

export function registerIniLockWatcher(): void {
  serverEvents.on('status', (status: ServerStatus) => handleStatusForIniLock(status))
}

/** Safety net for a Manager crash/force-quit while a server was running (and its config
 *  files were left read-only) - unlocks every profile that isn't currently running, once, at
 *  Manager startup, so a previous crash can't leave someone permanently unable to edit their
 *  config outside the app. */
export function unlockStoppedProfilesOnStartup(
  profiles: ServerProfile[],
  isRunning: (profileId: string) => boolean,
  apply: (installDir: string, readOnly: boolean) => Promise<void> = setConfigFilesReadOnly
): void {
  for (const profile of profiles) {
    if (!isRunning(profile.id)) void apply(profile.installDir, false)
  }
}

/**
 * Called at Manager startup and again right after every Settings save - when the feature is
 * currently disabled, immediately unlocks every profile's config files (including ones
 * whose server is running right now) and cancels any change still pending for them, so
 * turning the setting off takes effect right away instead of waiting for that server's next
 * start or stop. Does nothing when the feature is enabled - locking/unlocking then stays
 * driven entirely by handleStatusForIniLock reacting to actual status changes.
 */
export function applyIniLockSetting(
  enabled: boolean,
  profiles: ServerProfile[],
  apply: (installDir: string, readOnly: boolean) => Promise<void> = setConfigFilesReadOnly
): void {
  if (enabled) return
  for (const profile of profiles) {
    cancelPending(profile.id)
    void apply(profile.installDir, false)
  }
}
