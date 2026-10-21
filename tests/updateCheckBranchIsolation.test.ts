import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { ServerProfile } from '../shared/types'

// Real-world bug this covers: a profile pinned to a beta branch kept showing "A server
// update is available" forever, because the cached "latest" build id was only ever the
// public branch's - which a beta-pinned install was never trying to match in the first
// place. Simulates SteamCMD's app_info_print output once (it always returns every branch
// in one dump, regardless of which one the caller cares about) and proves the beta profile
// is compared against its own branch's build id instead.
const APP_INFO_OUTPUT = `
"2430930"
{
	"depots"
	{
		"branches"
		{
			"public"
			{
				"buildid"		"999"
			}
			"testing"
			{
				"buildid"		"500"
			}
		}
	}
}
`

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
    }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    setImmediate(() => {
      child.stdout.emit('data', APP_INFO_OUTPUT)
      child.emit('close')
    })
    return child
  }),
  exec: vi.fn()
}))

// checkLatestBuildId bails out before ever spawning anything unless this path exists on
// disk - a real (empty) file, rather than mocking fs.existsSync globally, since that would
// also intercept getInstalledBuildId's own manifest-existence checks below.
const fakeSteamCmdPath = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-update-steamcmd-'))
  const exe = path.join(dir, 'steamcmd.exe')
  fs.writeFileSync(exe, '')
  return exe
})()

let profiles: ServerProfile[] = []
vi.mock('../src/main/store', () => ({
  getSettings: () => ({ steamCmdPath: fakeSteamCmdPath }),
  listProfiles: () => profiles
}))

function makeProfile(overrides: Partial<ServerProfile> = {}): ServerProfile {
  return {
    id: 'beta-isolation-test',
    name: 'Dev PTR',
    installDir: '/tmp/does-not-matter',
    steamBetaEnabled: false,
    steamBetaName: '',
    game: 'ark-ascended',
    ...overrides
  } as ServerProfile
}

describe('isUpdateAvailableForProfile - per-branch cache isolation', () => {
  it("compares a beta-pinned profile against its own branch's build id, not the public branch's", async () => {
    const { pollOnce, isUpdateAvailableForProfile } = await import('../src/main/lib/updateCheck')
    const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-update-beta-test-'))
    try {
      const { getAppManifestPath } = await import('../src/main/lib/steamcmd')
      fs.mkdirSync(path.join(installDir, 'steamapps'), { recursive: true })
      // Installed build matches the beta branch's latest (500), not the public branch's (999).
      fs.writeFileSync(
        getAppManifestPath(installDir, 'ark-ascended'),
        '"AppState"\n{\n\t"appid"\t\t"2430930"\n\t"buildid"\t\t"500"\n}\n'
      )

      const betaProfile = makeProfile({ installDir, steamBetaEnabled: true, steamBetaName: 'testing' })
      profiles = [betaProfile]

      await pollOnce()

      // The old bug: this profile would always compare against "999" (public) and report an
      // update forever, even though it's fully up to date on its own "testing" branch.
      expect(isUpdateAvailableForProfile(betaProfile)).toBe(false)

      // A public-branch profile on the same install dir, for contrast - also up to date.
      const publicProfile = makeProfile({ installDir, id: 'public-sibling' })
      fs.writeFileSync(
        getAppManifestPath(installDir, 'ark-ascended'),
        '"AppState"\n{\n\t"appid"\t\t"2430930"\n\t"buildid"\t\t"999"\n}\n'
      )
      expect(isUpdateAvailableForProfile(publicProfile)).toBe(false)
    } finally {
      fs.rmSync(installDir, { recursive: true, force: true })
    }
  })
})
