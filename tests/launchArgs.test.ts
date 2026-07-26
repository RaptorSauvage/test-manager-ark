import { describe, expect, it } from 'vitest'
import { buildLaunchArgs } from '../src/main/lib/serverProcess'
import type { ServerProfile } from '../shared/types'

function makeProfile(overrides: Partial<ServerProfile> = {}): ServerProfile {
  return {
    id: 'test',
    name: 'Test',
    installDir: '/tmp/ark',
    map: 'TheIsland_WP',
    gamePort: 7777,
    queryPort: 27015,
    rconPort: 27020,
    rconPassword: 'secret',
    savedArksSubPath: 'ShooterGame/Saved/SavedArks',
    backupDir: '',
    maxBackups: 10,
    backupScheduleEnabled: false,
    mods: [],
    clusterEnabled: false,
    clusterId: '',
    clusterDirOverride: '',
    noTransferFromFiltering: false,
    extraArgs: '',
    ...overrides
  }
}

describe('buildLaunchArgs', () => {
  it('builds the map/port/RCON question-mark string', () => {
    const args = buildLaunchArgs(makeProfile())
    expect(args[0]).toBe(
      'TheIsland_WP?listen?Port=7777?QueryPort=27015?RCONEnabled=True?RCONPort=27020?ServerAdminPassword=secret'
    )
  })

  it('only passes enabled mods, appending -dev for dev-mode mods', () => {
    const args = buildLaunchArgs(
      makeProfile({
        mods: [
          { id: '111', enabled: true, dev: false },
          { id: '222', enabled: false, dev: false },
          { id: '333', enabled: true, dev: true }
        ]
      })
    )
    expect(args).toContain('-mods=111,333-dev')
  })

  it('omits -mods entirely when there are no enabled mods', () => {
    const args = buildLaunchArgs(makeProfile({ mods: [{ id: '111', enabled: false, dev: false }] }))
    expect(args.some((a) => a.startsWith('-mods='))).toBe(false)
  })

  it('appends extraArgs at the end', () => {
    const args = buildLaunchArgs(makeProfile({ extraArgs: '-NoBattlEye -SomeFlag=test' }))
    expect(args).toEqual(expect.arrayContaining(['-NoBattlEye', '-SomeFlag=test']))
  })

  it('omits every cluster flag when clusterEnabled is false, even with fields filled in', () => {
    const args = buildLaunchArgs(
      makeProfile({
        clusterEnabled: false,
        clusterId: 'my-cluster',
        clusterDirOverride: '/clusters/my-cluster',
        noTransferFromFiltering: true
      })
    )
    expect(args.some((a) => a.startsWith('-clusterid=') || a.startsWith('-ClusterDirOverride='))).toBe(false)
    expect(args).not.toContain('-NoTransferFromFiltering')
  })

  it('adds cluster flags, before extraArgs, when clusterEnabled is true', () => {
    const args = buildLaunchArgs(
      makeProfile({
        clusterEnabled: true,
        clusterId: 'my-cluster',
        clusterDirOverride: '/clusters/my-cluster',
        noTransferFromFiltering: true,
        extraArgs: '-NoBattlEye'
      })
    )
    const clusterIdIndex = args.indexOf('-clusterid=my-cluster')
    const clusterDirIndex = args.indexOf('-ClusterDirOverride=/clusters/my-cluster')
    const noTransferIndex = args.indexOf('-NoTransferFromFiltering')
    const extraArgIndex = args.indexOf('-NoBattlEye')

    expect(clusterIdIndex).toBeGreaterThan(-1)
    expect(clusterDirIndex).toBeGreaterThan(-1)
    expect(noTransferIndex).toBeGreaterThan(-1)
    expect(extraArgIndex).toBeGreaterThan(Math.max(clusterIdIndex, clusterDirIndex, noTransferIndex))
  })

  it('skips clusterid/ClusterDirOverride individually when their field is blank', () => {
    const args = buildLaunchArgs(makeProfile({ clusterEnabled: true, clusterId: '', clusterDirOverride: '' }))
    expect(args.some((a) => a.startsWith('-clusterid='))).toBe(false)
    expect(args.some((a) => a.startsWith('-ClusterDirOverride='))).toBe(false)
  })
})
