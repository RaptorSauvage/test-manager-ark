import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { platform } from 'node:process'
import { buildLaunchArgs, getExecutablePath } from '../src/main/lib/serverProcess'
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
    queryPort: 27015,
    serverPlatform: 'PC',
    maxPlayers: 70,
    backupDir: '',
    maxBackups: 10,
    backupScheduleEnabled: false,
    playerProfileBackupEnabled: false,
    playerProfileBackupMaxPerPlayer: 20,
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
    game: 'ark-ascended',
    maxDinoLevel: '',
    serverPassword: '',
    autoManageMods: false,
    extraArgs: '',
    scheduledRestartEnabled: false,
    scheduledRestartTime: '00:00',
    scheduledRestartDays: [],
    scheduledRestartUpdateAfter: false,
    scheduledRestartStartAfter: false,
    scheduledDinoWipeEnabled: false,
    scheduledDinoWipeTime: '00:00',
    scheduledDinoWipeDays: [],
    startOnManagerLaunch: false,
    hidden: false,
    group: '',
    crashWatchEnabled: false,
    zombieDetectionEnabled: false,
    zombieDetectionTimeoutMinutes: 10,
    zombieDetectionAutoRestart: false,
    clusterLogArchiveMaxSizeMB: 10,
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
          { id: '111', enabled: true, passive: false, dev: false },
          { id: '222', enabled: false, passive: false, dev: false },
          { id: '333', enabled: true, passive: false, dev: true }
        ]
      })
    )
    expect(args).toContain('-mods=111,333-dev')
  })

  it('omits -mods entirely when there are no enabled mods', () => {
    const args = buildLaunchArgs(makeProfile({ mods: [{ id: '111', enabled: false, passive: false, dev: false }] }))
    expect(args.some((a) => a.startsWith('-mods='))).toBe(false)
  })

  it('passes passive mods via -passivemods= instead of -mods=', () => {
    const args = buildLaunchArgs(
      makeProfile({
        mods: [
          { id: '111', enabled: true, passive: false, dev: false },
          { id: '222', enabled: true, passive: true, dev: false },
          { id: '333', enabled: true, passive: true, dev: true }
        ]
      })
    )
    expect(args).toContain('-mods=111')
    expect(args).toContain('-passivemods=222,333-dev')
  })

  it('omits -passivemods entirely when there are no enabled passive mods', () => {
    const args = buildLaunchArgs(
      makeProfile({ mods: [{ id: '111', enabled: true, passive: false, dev: false }] })
    )
    expect(args.some((a) => a.startsWith('-passivemods='))).toBe(false)
  })

  it('ignores a disabled passive mod for both -mods and -passivemods', () => {
    const args = buildLaunchArgs(
      makeProfile({ mods: [{ id: '111', enabled: false, passive: true, dev: false }] })
    )
    expect(args.some((a) => a.startsWith('-mods=') || a.startsWith('-passivemods='))).toBe(false)
  })

  it('appends extraArgs at the end', () => {
    const args = buildLaunchArgs(makeProfile({ extraArgs: '-NoBattlEye -SomeFlag=test' }))
    expect(args).toEqual(expect.arrayContaining(['-NoBattlEye', '-SomeFlag=test']))
  })

  it('drops an extraArgs flag that exactly duplicates one already emitted natively', () => {
    // A real report: a profile's Extra launch arguments still had -servergamelog left over
    // from before the Manager added it natively for ARK: Survival Evolved, so it appeared on
    // the command line twice.
    const args = buildLaunchArgs(makeProfile({ game: 'ark-evolved', extraArgs: '-nosound -servergamelog' }))
    expect(args.filter((a) => a === '-servergamelog')).toHaveLength(1)
    expect(args.filter((a) => a === '-nosound')).toHaveLength(1)
  })

  it('keeps two different extraArgs flags that are not duplicates of anything', () => {
    const args = buildLaunchArgs(makeProfile({ extraArgs: '-FlagA -FlagB' }))
    expect(args).toEqual(expect.arrayContaining(['-FlagA', '-FlagB']))
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

  it('passes -DestroyTamesOverLevel=<value> only when maxDinoLevel is non-empty', () => {
    const withoutFlag = buildLaunchArgs(makeProfile({ maxDinoLevel: '' }))
    expect(withoutFlag.some((a) => a.startsWith('-DestroyTamesOverLevel='))).toBe(false)
    expect(buildLaunchArgs(makeProfile({ maxDinoLevel: '150' }))).toContain('-DestroyTamesOverLevel=150')
  })

  it('trims whitespace around maxDinoLevel before using it', () => {
    expect(buildLaunchArgs(makeProfile({ maxDinoLevel: '  150  ' }))).toContain('-DestroyTamesOverLevel=150')
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

  describe('getExecutablePath', () => {
    it('resolves the right executable name per game, on this platform', () => {
      const ascendedPath = getExecutablePath(makeProfile({ game: 'ark-ascended', installDir: '/tmp/ark' }))
      const evolvedPath = getExecutablePath(makeProfile({ game: 'ark-evolved', installDir: '/tmp/ark' }))
      const ascendedExe = platform === 'win32' ? 'ArkAscendedServer.exe' : 'ArkAscendedServer'
      const evolvedExe = platform === 'win32' ? 'ShooterGameServer.exe' : 'ShooterGameServer'
      expect(ascendedPath).toBe(path.join('/tmp/ark', 'ShooterGame', 'Binaries', platform === 'win32' ? 'Win64' : 'Linux', ascendedExe))
      expect(evolvedPath).toBe(path.join('/tmp/ark', 'ShooterGame', 'Binaries', platform === 'win32' ? 'Win64' : 'Linux', evolvedExe))
      expect(ascendedPath).not.toBe(evolvedPath)
    })
  })

  describe('ark-evolved specific behavior', () => {
    it('adds QueryPort= to the ?-string, distinct from Port=', () => {
      const args = buildLaunchArgs(makeProfile({ game: 'ark-evolved', gamePort: 7777, queryPort: 27015 }))
      expect(args[0]).toContain('Port=7777?QueryPort=27015?RCONPort=')
    })

    it('matches the exact ?-string param order and flag order of a real, working launch line', () => {
      // A previous version that reordered these (e.g. RCONEnabled= before RCONPort=, or
      // -servergamelog right after the map string instead of after -NoBattlEye/
      // -ForceRespawnDinos) reproducibly caused a blocking "Plugin 'RuntimeMeshComponent'
      // failed to load" dialog on launch - this pins the exact confirmed-working shape so a
      // future refactor can't silently reintroduce that. -log was added after -servergamelog
      // later (see buildLaunchArgs) - -servergamelog's own position is the one that's
      // order-sensitive, not -log's.
      const args = buildLaunchArgs(
        makeProfile({
          game: 'ark-evolved',
          map: 'Gen2',
          gamePort: 8004,
          queryPort: 8102,
          rconPort: 8202,
          maxPlayers: 10,
          serverPassword: 'bober',
          disableBattlEye: true,
          forceRespawnDinos: true,
          rconTribeLog: true
        }),
        'bober'
      )
      expect(args[0]).toBe(
        'Gen2?Port=8004?QueryPort=8102?RCONPort=8202?RCONEnabled=True?MaxPlayers=10' +
          '?ServerAdminPassword=bober?ServerPassword=bober'
      )
      expect(args.slice(1)).toEqual([
        '-NoBattlEye',
        '-ForceRespawnDinos',
        '-servergamelog',
        '-log',
        '-servergamelogincludetribelogs',
        '-ServerRCONOutputTribeLogs'
      ])
    })

    it('never omits QueryPort= for ark-ascended, which merges it into Port=', () => {
      const args = buildLaunchArgs(makeProfile({ game: 'ark-ascended', gamePort: 7777, queryPort: 27015 }))
      expect(args[0]).not.toContain('QueryPort=')
    })

    it('omits ?listen, confirmed absent from a real working ark-evolved launch line', () => {
      const args = buildLaunchArgs(makeProfile({ game: 'ark-evolved' }))
      expect(args[0]).not.toMatch(/\?listen(\?|$)/)
    })

    it('still passes ?listen for ark-ascended', () => {
      const args = buildLaunchArgs(makeProfile({ game: 'ark-ascended' }))
      expect(args[0]).toMatch(/\?listen(\?|$)/)
    })

    it('omits -server (ARK: Survival Ascended-only), but adds both -servergamelog and -log', () => {
      // -log alone (without -servergamelog) is what ARK: Survival Ascended passes; ARK:
      // Survival Evolved needs both - -servergamelog for the dated tribe-log files, -log for
      // the engine's own ShooterGame.log the Manager's Console/version-detection actually
      // read (a real report showed both staying empty without it).
      const args = buildLaunchArgs(makeProfile({ game: 'ark-evolved' }))
      expect(args).not.toContain('-server')
      expect(args).toContain('-servergamelog')
      expect(args).toContain('-log')
    })

    it('still passes -server -log for ark-ascended, without -servergamelog', () => {
      const args = buildLaunchArgs(makeProfile({ game: 'ark-ascended' }))
      expect(args).toContain('-server')
      expect(args).toContain('-log')
      expect(args).not.toContain('-servergamelog')
    })

    it('passes MaxPlayers= inline in the ?-string instead of -WinLiveMaxPlayers=', () => {
      const args = buildLaunchArgs(makeProfile({ game: 'ark-evolved', maxPlayers: 10 }))
      expect(args[0]).toContain('MaxPlayers=10')
      expect(args.some((a) => a.startsWith('-WinLiveMaxPlayers='))).toBe(false)
    })

    it('passes ServerPassword= inline in the ?-string, a mandatory arg', () => {
      const args = buildLaunchArgs(makeProfile({ game: 'ark-evolved', serverPassword: 'bober' }))
      expect(args[0]).toContain('ServerPassword=bober')
    })

    it('still emits ServerPassword= blank rather than omitting it, since it is mandatory', () => {
      const args = buildLaunchArgs(makeProfile({ game: 'ark-evolved', serverPassword: '' }))
      expect(args[0]).toContain('ServerPassword=')
    })

    it('never adds ServerPassword= for ark-ascended', () => {
      const args = buildLaunchArgs(makeProfile({ game: 'ark-ascended', serverPassword: 'bober' }))
      expect(args[0]).not.toContain('ServerPassword=')
    })

    it('never adds SessionName= for either game - GameUserSettings.ini covers it instead', () => {
      const evolvedArgs = buildLaunchArgs(makeProfile({ game: 'ark-evolved' }))
      const ascendedArgs = buildLaunchArgs(makeProfile({ game: 'ark-ascended' }))
      expect(evolvedArgs[0]).not.toContain('SessionName=')
      expect(ascendedArgs[0]).not.toContain('SessionName=')
    })

    it('still passes -WinLiveMaxPlayers= for ark-ascended, without MaxPlayers= inline', () => {
      const args = buildLaunchArgs(makeProfile({ game: 'ark-ascended', maxPlayers: 42 }))
      expect(args).toContain('-WinLiveMaxPlayers=42')
      expect(args[0]).not.toContain('MaxPlayers=42')
    })

    it('omits -ServerPlatform=, unconfirmed for ark-evolved', () => {
      const args = buildLaunchArgs(makeProfile({ game: 'ark-evolved', serverPlatform: 'ALL' }))
      expect(args.some((a) => a.startsWith('-ServerPlatform='))).toBe(false)
    })

    it('omits -DestroyTamesOverLevel=, unconfirmed for ark-evolved, even when maxDinoLevel is set', () => {
      const args = buildLaunchArgs(makeProfile({ game: 'ark-evolved', maxDinoLevel: '150' }))
      expect(args.some((a) => a.startsWith('-DestroyTamesOverLevel='))).toBe(false)
    })

    it('never emits -mods=/-passivemods= for ark-evolved, confirmed to have no such mechanism at all', () => {
      const args = buildLaunchArgs(
        makeProfile({
          game: 'ark-evolved',
          mods: [
            { id: '111', enabled: true, passive: false, dev: false },
            { id: '222', enabled: true, passive: true, dev: true }
          ]
        })
      )
      expect(args.some((a) => a.startsWith('-mods='))).toBe(false)
      expect(args.some((a) => a.startsWith('-passivemods='))).toBe(false)
    })

    it('passes -automanagedmods only when autoManageMods is true, ark-evolved only', () => {
      expect(buildLaunchArgs(makeProfile({ game: 'ark-evolved', autoManageMods: false }))).not.toContain(
        '-automanagedmods'
      )
      expect(buildLaunchArgs(makeProfile({ game: 'ark-evolved', autoManageMods: true }))).toContain(
        '-automanagedmods'
      )
      expect(buildLaunchArgs(makeProfile({ game: 'ark-ascended', autoManageMods: true }))).not.toContain(
        '-automanagedmods'
      )
    })
  })
})
