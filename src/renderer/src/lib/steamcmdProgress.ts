export type SteamCmdStage = 'starting' | 'installing' | 'verifying' | 'complete' | 'error'

export interface SteamCmdProgress {
  stage: SteamCmdStage
  /** 0-100, best-effort - SteamCMD doesn't always print a final 100 line (see complete
   *  below), so this is clamped to 100 once stage is 'complete'. */
  percent: number
  label: string
}

/** SteamCMD's own verbose app_update output repeats lines like:
 *    Update state (0x61) downloading, progress: 42.17 (123456789 / 292837465)
 *    Update state (0x5) verifying install, progress: 95.39 (...)
 *  - the hex state code varies, but the free-text description and the "progress: N.NN"
 *  number are consistent across installs. Parses the *last* such line in the log (SteamCMD
 *  only ever appends), since that's the most current state. */
const PROGRESS_LINE = /Update state \(0x[0-9a-f]+\) ([a-z ]+), progress: ([\d.]+)/gi

/** Turns a server's raw SteamCMD update-log text (as tailed from
 *  window.api.steamcmd.getUpdateLog) into a stage/percent the "Create New Server" wizard's
 *  install step can show a progress bar and label for - best-effort, since it's reading
 *  SteamCMD's own free-text console output rather than a structured API. */
export function parseSteamCmdProgress(logText: string): SteamCmdProgress {
  if (!logText.trim()) {
    return { stage: 'starting', percent: 0, label: 'Starting SteamCMD...' }
  }

  // SteamCMD doesn't print a final "progress: 100" line - "Success! App '...' fully
  // installed." is the actual completion signal, and always comes after the last progress
  // line, so check it first.
  if (/Success! App '\d+' (fully installed|(?:already )?up to date)/i.test(logText)) {
    return { stage: 'complete', percent: 100, label: 'Complete' }
  }

  if (/ERROR!|Error!\s|Disk write failure|No subscription/i.test(logText)) {
    return { stage: 'error', percent: 0, label: 'Installation failed' }
  }

  let lastMatch: RegExpExecArray | null = null
  for (const match of logText.matchAll(PROGRESS_LINE)) lastMatch = match
  if (!lastMatch) {
    return { stage: 'starting', percent: 0, label: 'Connecting to Steam...' }
  }

  const description = lastMatch[1].trim().toLowerCase()
  const percent = Math.min(Math.max(Number(lastMatch[2]) || 0, 0), 100)
  if (description.includes('verifying')) {
    return { stage: 'verifying', percent, label: 'Verifying Installation' }
  }
  return { stage: 'installing', percent, label: 'Installing Server' }
}
