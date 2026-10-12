// Minimal leveled logger over stdout/stderr - the main process pipes both back into the
// Manager Log (see discordBot.ts's own supervisor), so this doesn't need its own file
// handling the way the standalone Python bot's `logging.basicConfig` did.
function line(level: string, message: string): string {
  return `${new Date().toISOString()} [${level}] ${message}`
}

export const log = {
  info(message: string): void {
    console.log(line('INFO', message))
  },
  warn(message: string): void {
    console.warn(line('WARN', message))
  },
  error(message: string): void {
    console.error(line('ERROR', message))
  }
}
