import type { MinecraftLaunchMode, MinecraftServerType } from './minecraft'

/** Server types this app can actually install from scratch - every real MinecraftServerType
 *  except 'unknown' (nothing to download for a type that isn't one of the others). */
export type MinecraftInstallableType = Exclude<MinecraftServerType, 'unknown'>

/** Vanilla and Spigot publish exactly one artifact per Minecraft version - there's no
 *  separate "loader/build version" to additionally choose, unlike every other installable
 *  type (Paper build numbers, Fabric loader versions, Forge/NeoForge/Sponge builds). Drives
 *  whether the Install dialog's and Start Settings' second version selector shows at all. */
export function supportsLoaderVersionSelection(serverType: MinecraftInstallableType): boolean {
  return serverType !== 'vanilla' && serverType !== 'spigot'
}

/** One selectable option in either the Install dialog's two version pickers - `id` is what
 *  gets sent back to installMinecraftServerFiles (as minecraftVersion or loaderVersion),
 *  `label` is what the dropdown shows (usually the same string, kept separate in case a
 *  source needs to show something extra, e.g. a build number or channel).  `recommended` -
 *  when true, the picker shows a star next to this option and preselects it: Forge's own
 *  `promotions_slim.json` and Paper's own "STABLE" build channel genuinely mark one build
 *  this way; for loaders with no such official signal (Fabric's "stable" flag, NeoForge/
 *  Sponge's own newest build), the newest/stable one is marked instead as a best-effort
 *  default - see each listInstallableLoaderVersions case in minecraftInstall.ts. */
export interface MinecraftVersionOption {
  id: string
  label: string
  recommended?: boolean
}

export interface MinecraftInstallParams {
  serverType: MinecraftInstallableType
  minecraftVersion: string
  /** The loader/build version picked in the second selector - required whenever
   *  supportsLoaderVersionSelection(serverType) is true, ignored otherwise (vanilla/Spigot
   *  only ever have the one artifact minecraftVersion itself already names). */
  loaderVersion?: string
  installDir: string
  /** Minecraft's EULA (https://www.minecraft.net/eula) must be accepted to run a server at
   *  all - the vanilla/Paper/Fabric/Forge/Spigot server itself refuses to start otherwise.
   *  Required to be true or installMinecraftServerFiles refuses outright, before downloading
   *  anything - this app never silently accepts it on the user's behalf. */
  acceptEula: boolean
}

export interface MinecraftInstallResult {
  installDir: string
  launchMode: MinecraftLaunchMode
  jarFileName: string
  scriptFileName: string
  minecraftVersion: string
  /** The loader/build version actually installed - set whenever
   *  supportsLoaderVersionSelection(serverType) is true, so the profile this result builds
   *  (see InstallMinecraftServerPanel.tsx) starts with its own MinecraftProfile.loaderVersion
   *  already filled in rather than blank. */
  loaderVersion?: string
  serverType: MinecraftInstallableType
}
