import type { MinecraftServerType } from '@shared/minecraft'
import neoforgeIcon from '../assets/games/neoforge.png'

/**
 * Per-loader icon, shown anywhere a server's `serverType` is displayed (the Dashboard card's
 * Type line, the Server type picker in Start Settings/the install dialog, the Mods tab's
 * Browse header) - deliberately a sparse `Partial` rather than one icon per
 * `MinecraftServerType`: only NeoForge has a real icon asset right now
 * (assets/games/neoforge.png), so every other type just shows its plain text label exactly as
 * it always has, and gets a real icon here too the moment one is actually added - no code
 * change needed at any of those call sites when that happens.
 */
export const MINECRAFT_SERVER_TYPE_ICONS: Partial<Record<MinecraftServerType, string>> = {
  neoforge: neoforgeIcon
}
