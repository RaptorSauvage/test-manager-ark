import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const FIREWALL_RULE_PREFIX = 'SteamCMD (ARK Manager)'

/**
 * PowerShell script that adds allow rules (inbound + outbound) for the given executable.
 * Silently no-ops if a rule with the same name already exists, so it's safe to re-run.
 */
export function buildFirewallRuleScript(steamCmdPath: string): string {
  const escapedPath = steamCmdPath.replace(/"/g, '`"')
  return [
    `New-NetFirewallRule -DisplayName "${FIREWALL_RULE_PREFIX} Out" -Direction Outbound -Program "${escapedPath}" -Action Allow -ErrorAction SilentlyContinue | Out-Null`,
    `New-NetFirewallRule -DisplayName "${FIREWALL_RULE_PREFIX} In" -Direction Inbound -Program "${escapedPath}" -Action Allow -ErrorAction SilentlyContinue | Out-Null`
  ].join('\n')
}

/**
 * PowerShell script that requests elevation (triggers a single UAC prompt) to run
 * `targetScriptPath`, then exits with that elevated process's own exit code so the caller
 * can tell success from a cancelled/failed prompt.
 */
export function buildElevationLauncherScript(targetScriptPath: string): string {
  const escapedPath = targetScriptPath.replace(/"/g, '`"')
  return [
    'try {',
    `  $p = Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','"${escapedPath}"')`,
    '  exit $p.ExitCode',
    '} catch {',
    '  exit 1',
    '}'
  ].join('\n')
}

/**
 * Adds Windows Firewall allow rules for `steamCmdPath`, prompting for admin elevation via
 * UAC just for this one action (the app itself keeps running unelevated). Windows-only.
 */
export function addFirewallRulesForSteamCmd(steamCmdPath: string): Promise<void> {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('Firewall rules can only be added on Windows.'))
  }

  return new Promise((resolve, reject) => {
    const stamp = Date.now()
    const ruleScriptPath = path.join(os.tmpdir(), `ark-manager-firewall-rule-${stamp}.ps1`)
    const launcherScriptPath = path.join(os.tmpdir(), `ark-manager-firewall-elevate-${stamp}.ps1`)

    fs.writeFileSync(ruleScriptPath, buildFirewallRuleScript(steamCmdPath), 'utf-8')
    fs.writeFileSync(launcherScriptPath, buildElevationLauncherScript(ruleScriptPath), 'utf-8')

    function cleanup(): void {
      fs.rmSync(ruleScriptPath, { force: true })
      fs.rmSync(launcherScriptPath, { force: true })
    }

    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcherScriptPath], {
      windowsHide: true
    })

    child.on('error', (err) => {
      cleanup()
      reject(err)
    })

    child.on('close', (code) => {
      cleanup()
      if (code === 0) {
        resolve()
      } else {
        reject(new Error('Could not add the firewall rule - the admin prompt may have been cancelled.'))
      }
    })
  })
}
