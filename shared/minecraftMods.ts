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

/** A mod/plugin this Manager has actually installed for a profile - the source of truth for
 *  what's managed here, same "the app only knows what it put there itself" philosophy as
 *  ARK's own mods list. A jar dropped into the mods/plugins folder by hand, outside the
 *  Manager, simply isn't tracked (a known v1 limitation, not a bug). */
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
