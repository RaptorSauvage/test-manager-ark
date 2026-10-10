import type { MinecraftLaunchMode, MinecraftServerType } from './minecraft'

/** Server types this app can actually install from scratch - every real MinecraftServerType
 *  except 'unknown' (nothing to download for a type that isn't one of the others). */
export type MinecraftInstallableType = Exclude<MinecraftServerType, 'unknown'>

/** One selectable Minecraft version for the Install dialog's version picker - `id` is what
 *  gets sent back to installMinecraftServerFiles, `label` is what the dropdown shows (usually
 *  the same string, kept separate in case a future source needs to show something extra,
 *  e.g. a build number). */
export interface MinecraftVersionOption {
  id: string
  label: string
}

export interface MinecraftInstallParams {
  serverType: MinecraftInstallableType
  minecraftVersion: string
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
  serverType: MinecraftInstallableType
}
