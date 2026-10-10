import type { MinecraftServerType } from '@shared/minecraft'
import vanillaIcon from '../assets/games/vanilla.png'
import paperIcon from '../assets/games/paper.png'
import fabricIcon from '../assets/games/fabric.png'
import forgeIcon from '../assets/games/forge.png'
import neoforgeIcon from '../assets/games/neoforge.png'
import spigotIcon from '../assets/games/spigot.jpg'

/**
 * Per-loader icon, shown anywhere a server's `serverType` is displayed (the Dashboard card's
 * Type line, the Server type picker in Start Settings/the install dialog, the Mods tab's
 * Browse header) - a `Partial` rather than one icon per `MinecraftServerType` so a type with
 * no real icon asset just keeps showing its plain text label exactly as it always has, and
 * gets a real icon here too the moment one is actually added - no code change needed at any
 * of those call sites when that happens. `forge`'s icon reuses the same asset as the
 * CurseForge mod-source logo (`assets/mod-sources/forge.png`) rather than a second copy with
 * a different name - both are the same Forge anvil artwork, just used for two different
 * meanings (the CurseForge brand there, the Forge loader type here).
 */
export const MINECRAFT_SERVER_TYPE_ICONS: Partial<Record<MinecraftServerType, string>> = {
  vanilla: vanillaIcon,
  paper: paperIcon,
  fabric: fabricIcon,
  forge: forgeIcon,
  neoforge: neoforgeIcon,
  spigot: spigotIcon
}
