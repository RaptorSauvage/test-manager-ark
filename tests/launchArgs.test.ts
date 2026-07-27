import { describe, expect, it } from 'vitest'
import { buildLaunchArgs } from '../src/main/lib/serverProcess'
import type { ServerProfile } from '../shared/types'

function makeProfile(overrides: Partial<ServerProfile> = {}): ServerProfile {
  return {
    id: 'test',
    name: 'Test',
    installDir: '/tmp/ark',
    map: 'TheIsland_WP',
    moddedMapEnabled: false,
    moddedMapId: '',
    gamePort: 7777,
    rconPort: 27020,
    serverPlatform: 'PC',
    maxPlayers: 70,
    backupDir: '',
    maxBackups: 10,
    backupScheduleEnabled: false,
    mods: [],
    clusterEnabled: false,
    clusterId: '',
    clusterDirOverride: '',
    noTransferFromFiltering: false,
    externalIp: '',
    cultureSettings: 'none',
    disableBattlEye: false,
    rconTribeLog: false,
    forceRespawnDinos: false,
    noSound: false,
    extraArgs: '',
    ...overrides
  }
}

describe('buildLaunchArgs', () => {
  it('builds the map/port/RCON question-mark string, with an injected admin password', () => {
    const args = buildLaunchArgs(makeProfile(), 'secret')
    expect(args[0]).toBe('TheIsland_WP?listen?Port=7777?RCONEnabled=True?RCONPort=27020?ServerAdminPassword=secret')
  })

  it('omits ServerAdminPassword when no admin password is set', () => {
    const args = buildLaunchArgs(makeProfile(), '')
    expect(args[0]).toBe('TheIsland_WP?listen?Port=7777?RCONEnabled=True?RCONPort=27020')
  })

  it('adds -ServerPlatform= right after -server -log, for both PC and ALL', () => {
    const pcArgs = buildLaunchArgs(makeProfile({ serverPlatform: 'PC' }), '')
    expect(pcArgs.slice(1, 4)).toEqual(['-server', '-log', '-ServerPlatform=PC'])

    const allArgs = buildLaunchArgs(makeProfile({ serverPlatform: 'ALL' }), '')
    expect(allArgs.slice(1, 4)).toEqual(['-server', '-log', '-ServerPlatform=ALL'])
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

  it('always passes -WinLiveMaxPlayers=', () => {
    const args = buildLaunchArgs(makeProfile({ maxPlayers: 42 }))
    expect(args).toContain('-WinLiveMaxPlayers=42')
  })

  it('omits -ServerIP= when clusterEnabled is false, even with externalIp filled in', () => {
    const args = buildLaunchArgs(makeProfile({ clusterEnabled: false, externalIp: '203.0.113.10' }))
    expect(args.some((a) => a.startsWith('-ServerIP='))).toBe(false)
  })

  it('passes -ServerIP= when clusterEnabled is true and externalIp is set', () => {
    const args = buildLaunchArgs(makeProfile({ clusterEnabled: true, externalIp: '203.0.113.10' }))
    expect(args).toContain('-ServerIP=203.0.113.10')
  })

  it('omits -culture= when cultureSettings is none', () => {
    const args = buildLaunchArgs(makeProfile({ cultureSettings: 'none' }))
    expect(args.some((a) => a.startsWith('-culture='))).toBe(false)
  })

  it('passes -culture=en or -culture=fr', () => {
    expect(buildLaunchArgs(makeProfile({ cultureSettings: 'en' }))).toContain('-culture=en')
    expect(buildLaunchArgs(makeProfile({ cultureSettings: 'fr' }))).toContain('-culture=fr')
  })

  it('passes -NoBattlEye only when disableBattlEye is true', () => {
    expect(buildLaunchArgs(makeProfile({ disableBattlEye: false }))).not.toContain('-NoBattlEye')
    expect(buildLaunchArgs(makeProfile({ disableBattlEye: true }))).toContain('-NoBattlEye')
  })

  it('passes both tribe log flags only when rconTribeLog is true', () => {
    const withoutFlag = buildLaunchArgs(makeProfile({ rconTribeLog: false }))
    expect(withoutFlag).not.toContain('-servergamelogincludetribelogs')
    expect(withoutFlag).not.toContain('-ServerRCONOutputTribeLogs')

    const withFlag = buildLaunchArgs(makeProfile({ rconTribeLog: true }))
    expect(withFlag).toContain('-servergamelogincludetribelogs')
    expect(withFlag).toContain('-ServerRCONOutputTribeLogs')
  })

  it('passes -ForceRespawnDinos only when forceRespawnDinos is true', () => {
    expect(buildLaunchArgs(makeProfile({ forceRespawnDinos: false }))).not.toContain('-ForceRespawnDinos')
    expect(buildLaunchArgs(makeProfile({ forceRespawnDinos: true }))).toContain('-ForceRespawnDinos')
  })

  it('passes -nosound only when noSound is true', () => {
    expect(buildLaunchArgs(makeProfile({ noSound: false }))).not.toContain('-nosound')
    expect(buildLaunchArgs(makeProfile({ noSound: true }))).toContain('-nosound')
  })

  it('omits -MapModID= when moddedMapEnabled is false, even with moddedMapId filled in', () => {
    const args = buildLaunchArgs(makeProfile({ moddedMapEnabled: false, moddedMapId: '123456' }))
    expect(args.some((a) => a.startsWith('-MapModID='))).toBe(false)
  })

  it('omits -MapModID= when moddedMapEnabled is true but moddedMapId is blank', () => {
    const args = buildLaunchArgs(makeProfile({ moddedMapEnabled: true, moddedMapId: '' }))
    expect(args.some((a) => a.startsWith('-MapModID='))).toBe(false)
  })

  it('passes -MapModID= when moddedMapEnabled is true and moddedMapId is set', () => {
    const args = buildLaunchArgs(makeProfile({ moddedMapEnabled: true, moddedMapId: '123456' }))
    expect(args).toContain('-MapModID=123456')
  })
})
