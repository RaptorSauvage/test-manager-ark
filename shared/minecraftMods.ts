/**
 * Mod/plugin browsing and installation - kept in its own file rather than growing
 * minecraft.ts further. Source-agnostic by design (`source` is a union, not a hardcoded
 * string) - Modrinth and CurseForge are each their own client module (modrinthClient.ts,
 * curseforgeClient.ts) feeding these same shapes, so neither source's own API shapes leak
 * past minecraftMods.ts.
 */

import type { MinecraftServerType } from './minecraft'

/** 'modrinth' and 'curseforge' are real sources a mod/plugin was found through - CurseForge
 *  needs its own API key (AppSettings.curseforgeApiKey; get one free at
 *  console.curseforge.com - see the README) and is skipped entirely, not an error, when
 *  that's empty. 'unknown' isn't a source to search/install from at all - it's what
 *  scanForInstalledMods assigns to a file it found in the mods/plugins folder but couldn't
 *  identify by hash/fingerprint against either source. Tracked anyway, with no metadata
 *  beyond its file name, so it still shows up and can be managed (enable/disable/remove)
 *  instead of silently sitting invisible in the folder. */
export type MinecraftModSource = 'modrinth' | 'curseforge' | 'unknown'

/** Only these server types have a mod/plugin ecosystem at all - vanilla ships nothing
 *  installable and 'unknown' means the Manager couldn't even guess, so there's nothing safe
 *  to assume either. Shared (not just main-process) so the renderer's Mods tab can decide
 *  whether to show its content or a "not applicable" message without an IPC round-trip. */
export function supportsMinecraftMods(serverType: MinecraftServerType): boolean {
  return serverType === 'forge' || serverType === 'fabric' || serverType === 'paper' || serverType === 'spigot'
}

/** A dependency `dependency_type` can mean four different things for install purposes:
 *  'required' ones are walked and installed automatically (installMod), 'optional' ones are
 *  listed for the user to decide (never auto-installed), 'embedded' ones are already bundled
 *  inside the parent jar (nothing to download), and 'incompatible' ones are a warning if
 *  already installed, never installed themselves. */
export type MinecraftModDependencyType = 'required' | 'optional' | 'incompatible' | 'embedded'

export interface MinecraftModDependency {
  projectId: string
  /** Project title, when resolvable (may be unknown for an 'incompatible' entry that's never
   *  actually fetched). */
  title?: string
  dependencyType: MinecraftModDependencyType
}

/** One entry in a search results list - normalized across sources, and already filtered to
 *  exclude anything that only runs client-side (server_side === 'unsupported' on Modrinth -
 *  nothing a dedicated server manager would ever need to install). */
export interface MinecraftModSearchResult {
  source: MinecraftModSource
  projectId: string
  slug: string
  title: string
  description: string
  iconUrl?: string
  downloads: number
  /** True if this project id is already in the profile's installedMods. */
  installed: boolean
}

/** A mod/plugin this Manager tracks for a profile - either installed through the Mods tab
 *  itself, or recognized afterward by scanning the mods/plugins folder (scanForInstalledMods,
 *  Modrinth-only for now - see its own doc comment). A scanned file whose hash matches a known
 *  Modrinth version gets the full metadata below (source: 'modrinth'); one that doesn't match
 *  anything (CurseForge-sourced, hand-built, or just not on Modrinth) is still tracked, as
 *  source: 'unknown' - its `versionId`/`versionNumber` are empty strings and `title`/`slug`
 *  fall back to the file name, but it still shows up and can be enabled/disabled/removed like
 *  any other entry. */
export interface InstalledMinecraftMod {
  source: MinecraftModSource
  /** A real Modrinth project id for source: 'modrinth'; a real (numeric, stringified)
   *  CurseForge mod id for source: 'curseforge'; a synthetic `local:<fileName>` id for
   *  source: 'unknown' (stable and unique per file, just not a real id from either source). */
  projectId: string
  slug: string
  title: string
  iconUrl?: string
  versionId: string
  versionNumber: string
  /** The real file name (e.g. "worldedit-7.3.0.jar") - independent of whether it's currently
   *  enabled, since the on-disk name while disabled is this plus ".disabled" (see `enabled`). */
  fileName: string
  enabled: boolean
  /** Why this was installed - 'user' for something explicitly installed/updated by name,
   *  'dependency' for something pulled in automatically to satisfy another mod's required
   *  dependency. Purely informational (e.g. so the UI can label it "required by X"). */
  installedAs: 'user' | 'dependency'
  installedAt: number
}

/** Result of installMod - what actually happened, so the UI can show it plainly rather than
 *  silently doing more (or less) than the user asked for. */
export interface MinecraftModInstallResult {
  installed: InstalledMinecraftMod[]
  /** Required dependencies that were walked and installed alongside the requested mod -
   *  already included in `installed` above; broken out here just for the UI's "also
   *  installed as a dependency: X, Y" message. */
  dependenciesInstalled: InstalledMinecraftMod[]
  /** Optional dependencies that exist but were deliberately NOT installed - surfaced so the
   *  user can add them by hand if they want them. */
  optionalDependenciesSkipped: MinecraftModDependency[]
  /** Already-installed mods this version declares itself incompatible with - a warning, not
   *  a block (the install still goes through; conflicting plugins/mods are the user's call). */
  incompatibleWithInstalled: MinecraftModDependency[]
}

export interface MinecraftModUpdateCheckResult {
  projectId: string
  /** True if a compatible version newer than the installed one exists. */
  updateAvailable: boolean
  latestVersionId?: string
  latestVersionNumber?: string
}

/** Result of scanForInstalledMods - what it found sitting in the mods/plugins folder that
 *  wasn't already tracked. Modrinth-only for now: CurseForge's own file-identification
 *  endpoint (murmur2 fingerprints, not a simple file hash) is a real follow-up, not
 *  implemented yet - an existing CurseForge-sourced file still gets picked up here, just as
 *  source: 'unknown' like anything else scanning can't place. */
export interface MinecraftModScanResult {
  /** Every untracked file found this scan, now added to installedMods (already reflected in
   *  the profile this call also returns) - identified files have source: 'modrinth' with full
   *  Modrinth metadata, unidentified ones have source: 'unknown' (see InstalledMinecraftMod).
   *  Filter by `source` to tell them apart. */
  adopted: InstalledMinecraftMod[]
}
