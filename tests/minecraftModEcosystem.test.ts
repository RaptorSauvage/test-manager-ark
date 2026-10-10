import { describe, expect, it } from 'vitest'
import { minecraftModEcosystem } from '../shared/minecraftMods'

describe('minecraftModEcosystem', () => {
  it('maps Forge/Fabric/NeoForge to "mods"', () => {
    expect(minecraftModEcosystem('forge')).toBe('mods')
    expect(minecraftModEcosystem('neoforge')).toBe('mods')
    expect(minecraftModEcosystem('fabric')).toBe('mods')
  })

  it('maps Paper/Spigot and both Sponge variants to "plugins"', () => {
    expect(minecraftModEcosystem('paper')).toBe('plugins')
    expect(minecraftModEcosystem('spigot')).toBe('plugins')
    expect(minecraftModEcosystem('spongevanilla')).toBe('plugins')
    expect(minecraftModEcosystem('spongeforge')).toBe('plugins')
  })

  it('returns null for vanilla/unknown - no mod/plugin ecosystem at all', () => {
    expect(minecraftModEcosystem('vanilla')).toBeNull()
    expect(minecraftModEcosystem('unknown')).toBeNull()
  })
})
