import { describe, expect, it } from 'vitest'
import { fetchModNames } from '../src/main/lib/steamWorkshop'

function fakeFetch(payload: unknown, ok = true, status = 200): typeof fetch {
  return (async () =>
    ({
      ok,
      status,
      json: async () => payload
    }) as Response) as unknown as typeof fetch
}

describe('fetchModNames', () => {
  it('returns an empty map without calling fetch when there are no ids', async () => {
    let called = false
    const fetchImpl = (async () => {
      called = true
      throw new Error('should not be called')
    }) as unknown as typeof fetch

    expect(await fetchModNames([], fetchImpl)).toEqual({})
    expect(called).toBe(false)
  })

  it('maps published file ids to titles, skipping failed lookups', async () => {
    const fetchImpl = fakeFetch({
      response: {
        publishedfiledetails: [
          { publishedfileid: '111', result: 1, title: 'Super Structures' },
          { publishedfileid: '222', result: 9, title: 'Should be ignored' },
          { publishedfileid: '333', result: 1 }
        ]
      }
    })

    const names = await fetchModNames(['111', '222', '333'], fetchImpl)
    expect(names).toEqual({ '111': 'Super Structures' })
  })

  it('throws when the Steam API responds with a non-ok status', async () => {
    const fetchImpl = fakeFetch({}, false, 503)
    await expect(fetchModNames(['111'], fetchImpl)).rejects.toThrow(/503/)
  })
})
