import type { ServerProfile, ServerMod } from '@shared/types'

/**
 * Normalizes profiles saved by older versions of the app:
 * - `activeMods: string[]` became `mods: ServerMod[]`
 * - `ServerMod` gained a required `dev` flag
 * - `backupScheduleEnabled` is new; profiles that already had a cron string
 *   keep working (treated as enabled), everyone else defaults to off
 */
export function migrateProfile(
  raw: ServerProfile & { activeMods?: string[]; backupScheduleEnabled?: boolean }
): ServerProfile {
  const { activeMods, ...rest } = raw
  const sourceMods: Array<Partial<ServerMod> & { id: string }> = Array.isArray(rest.mods)
    ? rest.mods
    : (activeMods ?? []).map((id) => ({ id }))

  const mods: ServerMod[] = sourceMods.map((mod) => ({
    id: mod.id,
    name: mod.name,
    enabled: mod.enabled ?? true,
    dev: mod.dev ?? false
  }))

  const backupScheduleEnabled = rest.backupScheduleEnabled ?? Boolean(rest.backupSchedule)

  return { ...rest, mods, backupScheduleEnabled }
}
