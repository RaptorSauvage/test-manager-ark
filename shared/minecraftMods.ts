/**
 * Mod/plugin browsing and installation - kept in its own file rather than growing
 * minecraft.ts further, and deliberately modeled source-agnostic (`source: 'modrinth'`
 * today) even though only Modrinth is implemented so far. CurseForge requires its own API
 * key (obtained by registering as a developer at console.curseforge.com - see the README)
 * and is a planned follow-up, not yet implemented; a second source should only mean adding
 * another case to the `source` union and its own client module, not touching these shapes.
 */

import type { MinecraftServerType } from './minecraft'

export type MinecraftModSource = 'modrinth'

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
 *  itself, or recognized afterward by scanning the mods/plugins folder (scanForInstalledMods)
 *  and matching an untracked file's hash against Modrinth's own records, the same mechanism
 *  Modrinth's own official app uses to recognize an existing install. A file that doesn't
 *  match anything Modrinth knows about (CurseForge-sourced, or not on Modrinth at all) still
 *  isn't tracked - scanForInstalledMods reports how many it couldn't identify. */
export interface InstalledMinecraftMod {
  source: MinecraftModSource
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
 *  wasn't already tracked. */
export interface MinecraftModScanResult {
  /** Newly recognized and added to installedMods - already reflected in the profile this
   *  call also returns. */
  adopted: InstalledMinecraftMod[]
  /** Untracked files found that couldn't be matched to a known Modrinth version by hash -
   *  still sitting in the folder, just not something this app can manage yet (CurseForge-
   *  sourced, hand-built, or simply not on Modrinth). */
  unidentifiedCount: number
}
