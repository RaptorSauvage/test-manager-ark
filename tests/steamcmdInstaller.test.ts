import { describe, expect, it } from 'vitest'
import { getManagedExecutablePath } from '../src/main/lib/steamcmdInstaller'

describe('getManagedExecutablePath', () => {
  it('uses steamcmd.exe on Windows', () => {
    expect(getManagedExecutablePath('/managed/steamcmd', 'win32')).toBe('/managed/steamcmd/steamcmd.exe')
  })

  it('uses steamcmd.sh on Linux and macOS', () => {
    expect(getManagedExecutablePath('/managed/steamcmd', 'linux')).toBe('/managed/steamcmd/steamcmd.sh')
    expect(getManagedExecutablePath('/managed/steamcmd', 'darwin')).toBe('/managed/steamcmd/steamcmd.sh')
  })
})
