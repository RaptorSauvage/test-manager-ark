/** Ambient types for pidusage's internal Windows backends - see processStats.ts for why
 *  these are used directly instead of going through pidusage's own public API. Neither
 *  submodule ships its own types (only the package's main entry point does). */

type PidusageInternalStats = Record<
  number,
  { cpu: number; memory: number; ppid: number; pid: number; ctime: number; elapsed: number; timestamp: number }
>

declare module 'pidusage/lib/wmic' {
  function wmic(
    pids: number[],
    options: Record<string, unknown>,
    done: (err: Error | null, stats: PidusageInternalStats) => void
  ): void
  export = wmic
}

declare module 'pidusage/lib/gwmi' {
  function gwmi(
    pids: number[],
    options: Record<string, unknown>,
    done: (err: Error | null, stats: PidusageInternalStats) => void
  ): void
  export = gwmi
}
