import { describe, expect, it } from 'vitest'
import { parseSteamCmdProgress } from '../src/renderer/src/lib/steamcmdProgress'

describe('parseSteamCmdProgress', () => {
  it('reports "starting" for an empty log', () => {
    expect(parseSteamCmdProgress('')).toEqual({ stage: 'starting', percent: 0, label: 'Starting SteamCMD...' })
  })

  it('reports "starting" before any progress line has been printed yet', () => {
    const log = 'Redirecting stderr to \'C:\\steamcmd\\logs\\stderr.txt\'\nLogging directory: \'C:\\steamcmd\\logs\''
    expect(parseSteamCmdProgress(log).stage).toBe('starting')
  })

  it('parses a downloading/installing progress line', () => {
    const log = "Update state (0x61) downloading, progress: 42.17 (123456789 / 292837465)"
    const result = parseSteamCmdProgress(log)
    expect(result.stage).toBe('installing')
    expect(result.percent).toBeCloseTo(42.17)
  })

  it('parses a verifying progress line', () => {
    const log = 'Update state (0x5) verifying install, progress: 95.39 (10436718420 / 12222424592)'
    const result = parseSteamCmdProgress(log)
    expect(result.stage).toBe('verifying')
    expect(result.percent).toBeCloseTo(95.39)
  })

  it('uses the last progress line when several are present', () => {
    const log = [
      'Update state (0x5) verifying install, progress: 68.16 (8330357335 / 12222424592)',
      'Update state (0x5) verifying install, progress: 85.39 (10436718420 / 12222424592)',
      'Update state (0x0) unknown, progress: 0.00 (0 / 0)'
    ].join('\n')
    expect(parseSteamCmdProgress(log).percent).toBeCloseTo(0)
  })

  it('reports "complete" once the success line appears, even with stale progress lines before it', () => {
    const log = [
      'Update state (0x5) verifying install, progress: 91.13 (11138169333 / 12222424592)',
      "Update state (0x0) unknown, progress: 0.00 (0 / 0)",
      "Success! App '2430930' fully installed."
    ].join('\n')
    expect(parseSteamCmdProgress(log)).toEqual({ stage: 'complete', percent: 100, label: 'Complete' })
  })

  it('reports "error" when SteamCMD prints a failure', () => {
    const log = 'ERROR! Failed to install app \'2430930\' (Disk write failure)'
    expect(parseSteamCmdProgress(log).stage).toBe('error')
  })

  it('clamps an out-of-range percent into 0-100', () => {
    const log = 'Update state (0x61) downloading, progress: 142.00 (1 / 1)'
    expect(parseSteamCmdProgress(log).percent).toBe(100)
  })
})
