import { describe, expect, it } from 'vitest'
import { parseLatestPublicBuildId, isUpdateAvailable, isUpdateAvailableForProfile } from '../src/main/lib/updateCheck'
import type { ServerProfile } from '../shared/types'

describe('parseLatestPublicBuildId', () => {
  it('reads the buildid out of the public branch inside a realistic app_info_print dump', () => {
    const output = `
"2430930"
{
	"common"
	{
		"name"		"ARK Survival Ascended Dedicated Server"
	}
	"depots"
	{
		"branches"
		{
			"public"
			{
				"buildid"		"18742069"
				"timeupdated"		"1732000000"
			}
			"beta"
			{
				"buildid"		"18800000"
				"timeupdated"		"1733000000"
			}
		}
	}
}
`
    expect(parseLatestPublicBuildId(output)).toBe('18742069')
  })

  it('returns null when there is no branches section at all', () => {
    expect(parseLatestPublicBuildId('"2430930"\n{\n\t"common" { "name" "ARK" }\n}\n')).toBeNull()
  })

  it('returns null when there is a branches section but no public sub-key', () => {
    const output = '"2430930"\n{\n\t"branches"\n\t{\n\t\t"beta"\n\t\t{\n\t\t\t"buildid"\t\t"123"\n\t\t}\n\t}\n}\n'
    expect(parseLatestPublicBuildId(output)).toBeNull()
  })

  it('returns null when the public block has no buildid within it', () => {
    const output = '"branches"\n{\n\t"public"\n\t{\n\t\t"timeupdated"\t\t"123"\n\t}\n}\n'
    expect(parseLatestPublicBuildId(output)).toBeNull()
  })
})

describe('isUpdateAvailable', () => {
  it('is true when both ids are known and differ', () => {
    expect(isUpdateAvailable('18742069', '18800000')).toBe(true)
  })

  it('is false when both ids are known and match', () => {
    expect(isUpdateAvailable('18742069', '18742069')).toBe(false)
  })

  it('is false when the installed id is unknown (never installed)', () => {
    expect(isUpdateAvailable(null, '18800000')).toBe(false)
  })

  it('is false when the latest id is unknown (never polled)', () => {
    expect(isUpdateAvailable('18742069', null)).toBe(false)
  })

  it('is false when both are unknown', () => {
    expect(isUpdateAvailable(null, null)).toBe(false)
  })
})

describe('isUpdateAvailableForProfile', () => {
  function makeProfile(overrides: Partial<ServerProfile> = {}): ServerProfile {
    return { id: 'update-check-test', name: 'Test', game: 'ark-ascended', installDir: '/tmp/does-not-exist', ...overrides } as ServerProfile
  }

  it("is false for a game that doesn't support update checking, regardless of anything else", () => {
    expect(isUpdateAvailableForProfile(makeProfile({ game: 'ark-evolved' }))).toBe(false)
  })

  it('is false when nothing has ever been polled for this game (fresh cache)', () => {
    // No poll has happened in this test run, so getLatestBuildIdCache(...).buildId is null -
    // this also proves the manifest on disk (installDir points nowhere real) is never even
    // read in that case, since reading it would be ENOENT, not a thrown error here.
    expect(isUpdateAvailableForProfile(makeProfile({ game: 'ark-ascended' }))).toBe(false)
  })
})
