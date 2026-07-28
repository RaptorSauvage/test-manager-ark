import { describe, expect, it } from 'vitest'
import { parseLatestPublicBuildId } from '../src/main/lib/updateCheck'

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
