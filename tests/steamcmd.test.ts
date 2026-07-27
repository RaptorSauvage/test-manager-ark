import { describe, expect, it } from 'vitest'
import { buildUpdateArgs, describeSteamCmdExitCode } from '../src/main/lib/steamcmd'

describe('buildUpdateArgs', () => {
  it('targets the ARK:SA dedicated server app id with anonymous login and validation', () => {
    const args = buildUpdateArgs('/servers/my-ark')
    expect(args).toEqual([
      '+force_install_dir',
      '/servers/my-ark',
      '+login',
      'anonymous',
      '+app_update',
      '2430930',
      'validate',
      '+quit'
    ])
  })
})

describe('describeSteamCmdExitCode', () => {
  it('explains exit code 7 as a network/first-run issue', () => {
    expect(describeSteamCmdExitCode(7)).toMatch(/Steam.*online/i)
  })

  it('explains exit code 8 as a disk space issue', () => {
    expect(describeSteamCmdExitCode(8)).toMatch(/disk space/i)
  })

  it('falls back to the raw code for undocumented exit codes', () => {
    expect(describeSteamCmdExitCode(42)).toBe('SteamCMD exited with code 42')
  })
})
