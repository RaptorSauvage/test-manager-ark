import type { ServerProfile } from '@shared/types'

/**
 * Starts every profile with `startOnManagerLaunch` enabled that isn't already running
 * (e.g. re-adopted from a previous Manager session), staggered by `staggerSeconds`
 * between each one so they don't all launch at once - the first one starts immediately.
 */
export function runAutoStart(
  profiles: ServerProfile[],
  staggerSeconds: number,
  isRunning: (profileId: string) => boolean,
  startProfile: (profile: ServerProfile) => void,
  scheduleTimeout: (fn: () => void, ms: number) => void = (fn, ms) => setTimeout(fn, ms)
): void {
  const toStart = profiles.filter((profile) => profile.startOnManagerLaunch && !isRunning(profile.id))
  const delayMs = Math.max(0, staggerSeconds) * 1000

  toStart.forEach((profile, index) => {
    scheduleTimeout(() => {
      try {
        startProfile(profile)
      } catch (err) {
        console.error(`Auto-start failed for ${profile.name}:`, (err as Error).message)
      }
    }, index * delayMs)
  })
}
