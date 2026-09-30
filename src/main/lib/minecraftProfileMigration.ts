import type { MinecraftProfile } from '@shared/minecraft'

/**
 * Normalizes a Minecraft profile saved by an earlier version of the app - `serverType` and
 * every `scheduledRestart*` field were added after Minecraft support first shipped, so a
 * profile saved before that (including the very first ones anyone actually imported) has
 * none of them at runtime, despite the stored type claiming otherwise. Reading one of those
 * fields as its declared type when it's actually `undefined` doesn't just show a wrong
 * value - `ScheduleDaysPicker` calls `.includes()` directly on `scheduledRestartDays`, so an
 * unmigrated profile crashed the whole renderer (a blank window) the instant its Server
 * Management tab was opened. Mirrors ARK's own migrateProfile in profileMigration.ts.
 */
export function migrateMinecraftProfile(profile: MinecraftProfile): MinecraftProfile {
  return {
    ...profile,
    serverType: profile.serverType ?? 'unknown',
    scheduledRestartEnabled: profile.scheduledRestartEnabled ?? false,
    scheduledRestartTime: profile.scheduledRestartTime ?? '00:00',
    scheduledRestartDays: profile.scheduledRestartDays ?? [],
    scheduledRestartStartAfter: profile.scheduledRestartStartAfter ?? true,
    backupDir: profile.backupDir ?? '',
    maxBackups: profile.maxBackups ?? 10,
    backupScheduleEnabled: profile.backupScheduleEnabled ?? false
  }
}
