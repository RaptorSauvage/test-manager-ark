import { describe, expect, it } from 'vitest'
import { buildUpdateArgs } from '../src/main/lib/steamcmd'

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
