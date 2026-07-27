import { describe, expect, it } from 'vitest'
import { buildFirewallRuleScript, buildElevationLauncherScript } from '../src/main/lib/firewall'

describe('buildFirewallRuleScript', () => {
  it('adds inbound and outbound allow rules for the given executable', () => {
    const script = buildFirewallRuleScript('C:\\Manager\\steamcmd\\steamcmd.exe')
    expect(script).toContain('New-NetFirewallRule')
    expect(script).toContain('-Direction Outbound')
    expect(script).toContain('-Direction Inbound')
    expect(script).toContain('-Action Allow')
    expect(script).toContain('C:\\Manager\\steamcmd\\steamcmd.exe')
  })

  it('escapes double quotes in the path', () => {
    const script = buildFirewallRuleScript('C:\\Weird "Path"\\steamcmd.exe')
    expect(script).toContain('C:\\Weird `"Path`"\\steamcmd.exe')
  })
})

describe('buildElevationLauncherScript', () => {
  it('requests elevation via Start-Process -Verb RunAs and forwards the exit code', () => {
    const script = buildElevationLauncherScript('C:\\Temp\\rule.ps1')
    expect(script).toContain('-Verb RunAs')
    expect(script).toContain('C:\\Temp\\rule.ps1')
    expect(script).toContain('exit $p.ExitCode')
  })
})
