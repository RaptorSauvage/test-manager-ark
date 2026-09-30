import type { MinecraftProfile } from '@shared/minecraft'

export function createDefaultMinecraftProfile(name: string): MinecraftProfile {
  return {
    id: crypto.randomUUID(),
    name,
    serverType: 'unknown',
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
    startOnManagerLaunch: false,
    scheduledRestartEnabled: false,
    scheduledRestartTime: '00:00',
    scheduledRestartDays: [],
    scheduledRestartStartAfter: true,
    backupDir: '',
    maxBackups: 10,
    backupScheduleEnabled: false
  }
}
