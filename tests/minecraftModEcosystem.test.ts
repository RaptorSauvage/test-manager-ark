import { describe, expect, it } from 'vitest'
import { minecraftModEcosystem, minecraftServerSupportsEcosystem } from '../shared/minecraftMods'

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

describe('minecraftServerSupportsEcosystem', () => {
  it('matches minecraftModEcosystem for every single-ecosystem type', () => {
    expect(minecraftServerSupportsEcosystem('forge', 'mods')).toBe(true)
    expect(minecraftServerSupportsEcosystem('forge', 'plugins')).toBe(false)
    expect(minecraftServerSupportsEcosystem('paper', 'plugins')).toBe(true)
    expect(minecraftServerSupportsEcosystem('paper', 'mods')).toBe(false)
    expect(minecraftServerSupportsEcosystem('spongevanilla', 'plugins')).toBe(true)
    expect(minecraftServerSupportsEcosystem('spongevanilla', 'mods')).toBe(false)
  })

  it('SpongeForge uniquely supports both ecosystems at once', () => {
    expect(minecraftServerSupportsEcosystem('spongeforge', 'mods')).toBe(true)
    expect(minecraftServerSupportsEcosystem('spongeforge', 'plugins')).toBe(true)
  })

  it('vanilla/unknown support neither ecosystem', () => {
    expect(minecraftServerSupportsEcosystem('vanilla', 'mods')).toBe(false)
    expect(minecraftServerSupportsEcosystem('vanilla', 'plugins')).toBe(false)
    expect(minecraftServerSupportsEcosystem('unknown', 'mods')).toBe(false)
    expect(minecraftServerSupportsEcosystem('unknown', 'plugins')).toBe(false)
  })
})
