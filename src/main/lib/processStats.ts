import { platform } from 'node:process'
import { promisify } from 'node:util'
import pidusage from 'pidusage'
import wmic from 'pidusage/lib/wmic'
import gwmi from 'pidusage/lib/gwmi'

export interface ProcessStats {
  cpu: number
  memory: number
}

const wmicAsync = promisify(wmic)
const gwmiAsync = promisify(gwmi)

/** Once a wmic attempt has failed, stick with the PowerShell fallback for the rest of this
 *  process's lifetime rather than re-trying (and re-waiting on) a command that isn't coming
 *  back - wmic.exe being missing is a property of the machine, not a one-off hiccup. */
let useGwmi = false

/**
 * Windows-only CPU/RAM reader, bypassing pidusage's own wmic-vs-PowerShell dispatch.
 *
 * pidusage@4.x added a PowerShell (`Get-WmiObject`) fallback specifically for Windows builds
 * that have removed `wmic.exe` by default, but its own detection - a quick throwaway spawn of
 * `wmic` it wraps in a try/catch - doesn't reliably catch the failure in this app's
 * Electron/Node environment (a missing `wmic.exe` still surfaces as a raw `ENOENT` from the
 * real read, rather than triggering the fallback). Calling wmic.js/gwmi.js directly - the same
 * implementations pidusage itself ships and uses once dispatched - sidesteps that broken
 * detection while reusing its already-correct stats math.
 */
async function readWindowsProcessStats(pid: number): Promise<ProcessStats> {
  if (!useGwmi) {
    try {
      const stats = await wmicAsync([pid], {})
      return stats[pid]
    } catch {
      useGwmi = true
    }
  }
  const stats = await gwmiAsync([pid], {})
  return stats[pid]
}

/** Reads a process's current CPU%/RAM usage. Delegates to `pidusage` as-is on every platform
 *  except Windows, where {@link readWindowsProcessStats} is used instead (see above). */
export async function getProcessStats(pid: number): Promise<ProcessStats> {
  if (platform === 'win32') return readWindowsProcessStats(pid)
  return pidusage(pid)
}
