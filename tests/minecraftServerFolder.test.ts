import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { MinecraftProfile } from '../shared/minecraft'

const mockOpenPath = vi.fn(async () => '')
vi.mock('electron', () => ({ shell: { openPath: (p: string) => mockOpenPath(p) } }))

import { openMinecraftServerRootFolder } from '../src/main/lib/minecraftBackup'

function makeProfile(overrides: Partial<MinecraftProfile> = {}, installDir: string): MinecraftProfile {
  return {
    id: 'mc-root-folder-test',
    name: 'Root Folder Test Server',
    serverType: 'fabric',
    installDir,
    minecraftVersion: '',
    launchMode: 'jar',
    jarFileName: 'server.jar',
    scriptFileName: '',
    minMemoryMB: 1024,
    maxMemoryMB: 2048,
    extraJvmArgs: '',
    extraProgramArgs: '',
    hidden: false,
    group: '',
    startOnManagerLaunch: false,
    scheduledRestartEnabled: false,
    scheduledRestartTime: '00:00',
    scheduledRestartDays: [],
    scheduledRestartStartAfter: true,
    backupDir: '',
    maxBackups: 10,
    backupScheduleEnabled: false,
    installedMods: [],
    ...overrides
  }
}

describe('openMinecraftServerRootFolder', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-root-folder-test-'))
    mockOpenPath.mockClear()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('opens the install directory when it exists', async () => {
    const profile = makeProfile({}, tmpDir)
    await openMinecraftServerRootFolder(profile)
    expect(mockOpenPath).toHaveBeenCalledWith(tmpDir)
  })

  it('rejects when the install directory is empty', async () => {
    const profile = makeProfile({}, '')
    await expect(openMinecraftServerRootFolder(profile)).rejects.toThrow(/install directory/)
    expect(mockOpenPath).not.toHaveBeenCalled()
  })

  it('rejects when the install directory does not exist on disk', async () => {
    const profile = makeProfile({}, path.join(tmpDir, 'does-not-exist'))
    await expect(openMinecraftServerRootFolder(profile)).rejects.toThrow(/install directory/)
    expect(mockOpenPath).not.toHaveBeenCalled()
  })
})
