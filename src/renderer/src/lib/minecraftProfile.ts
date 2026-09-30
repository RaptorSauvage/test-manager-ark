import type { MinecraftProfile } from '@shared/minecraft'

export function createDefaultMinecraftProfile(name: string): MinecraftProfile {
  return {
    id: crypto.randomUUID(),
    name,
    installDir: '',
    launchMode: 'jar',
    jarFileName: '',
    scriptFileName: '',
    minMemoryMB: 2048,
    maxMemoryMB: 4096,
    extraJvmArgs: '',
    extraProgramArgs: 'nogui',
    hidden: false,
    group: '',
    startOnManagerLaunch: false
  }
}
