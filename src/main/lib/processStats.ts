import { spawn } from 'node:child_process'
import { platform } from 'node:process'
import pidusage from 'pidusage'

export interface ProcessStats {
  cpu: number
  memory: number
}

interface HistoryEntry {
  cpuMs: number
  timestamp: number
}

/** Per-pid CPU-time snapshot from the previous read, so cpu% can be derived as a delta over
 *  wall-clock time (a single WMI/Get-Process read only gives total CPU time accumulated
 *  since the process started, not a percentage) - kept independent of pidusage's own
 *  history module rather than reused, since this app no longer goes through pidusage's
 *  Windows backends at all (see readWindowsProcessStats). */
const history = new Map<number, HistoryEntry>()

function runPowerShell(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('powershell.exe', args, { windowsHide: true })
    } catch (err) {
      reject(err as Error)
      return
    }
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => (stdout += chunk))
    child.stderr?.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `powershell.exe exited with code ${code}`))
        return
      }
      resolve(stdout)
    })
  })
}

/**
 * Windows-only CPU/RAM reader via PowerShell's `Get-Process`, bypassing `pidusage`
 * entirely on this platform.
 *
 * Both of pidusage's own Windows backends proved unreliable in practice: its `wmic` path
 * breaks outright on the growing number of Windows installs that no longer ship
 * `wmic.exe`, and its documented PowerShell fallback invokes `powershell.exe` without
 * `-NoProfile`, so on any machine where the user's own PowerShell profile script fails to
 * load (script execution disabled by policy, in one case actually observed) every single
 * reading fails with a PSSecurityException before the real query ever runs - regardless of
 * whether that query itself would have worked. `-NoProfile` plus an explicit
 * `-ExecutionPolicy Bypass` (scoped to just this one process, not a system-wide policy
 * change) sidesteps both failure modes.
 */
async function readWindowsProcessStats(pid: number): Promise<ProcessStats> {
  const script = [
    `$p = Get-Process -Id ${pid} -ErrorAction Stop`,
    '$cpu = if ($null -eq $p.CPU) { 0 } else { $p.CPU }',
    "Write-Output ($cpu.ToString([System.Globalization.CultureInfo]::InvariantCulture) + '|' + $p.WorkingSet64.ToString([System.Globalization.CultureInfo]::InvariantCulture))"
  ].join('; ')

  const stdout = await runPowerShell(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script])
  const [cpuSecondsRaw, memoryRaw] = stdout.trim().split('|')
  const cpuMs = Number(cpuSecondsRaw) * 1000
  const memory = Number(memoryRaw)
  if (!Number.isFinite(cpuMs) || !Number.isFinite(memory)) {
    throw new Error(`Could not parse PowerShell process stats output: ${stdout.trim()}`)
  }

  const timestamp = Date.now()
  const previous = history.get(pid)
  history.set(pid, { cpuMs, timestamp })

  const elapsedMs = previous ? timestamp - previous.timestamp : 0
  const cpu = previous && elapsedMs > 0 ? Math.max(((cpuMs - previous.cpuMs) / elapsedMs) * 100, 0) : 0

  return { cpu, memory }
}

/** Reads a process's current CPU%/RAM usage. Delegates to `pidusage` as-is on every platform
 *  except Windows, where {@link readWindowsProcessStats} is used instead (see above). */
export async function getProcessStats(pid: number): Promise<ProcessStats> {
  if (platform === 'win32') return readWindowsProcessStats(pid)
  return pidusage(pid)
}
