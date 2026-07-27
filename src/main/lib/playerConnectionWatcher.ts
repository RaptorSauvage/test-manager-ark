import { watchLogFile } from './serverProcess'

export type PlayerConnectionEventType = 'joined' | 'left'

export interface PlayerConnectionEvent {
  type: PlayerConnectionEventType
  playerName: string
  /** ARK:SA's EOS-based player id, e.g. "0002dbe9ab20413e9b8e7e1562b76868" - also the
   *  filename (minus extension) of that player's .arkprofile under SavedArks/<map>. */
  uniqueNetId: string
}

// Matches lines like:
// [2026.07.27-21.25.23:191][991]2026.07.27_21.25.23: LeRaptorSauvage [UniqueNetId:0002dbe9ab20413e9b8e7e1562b76868 Platform:None] joined this ARK!
const LINE_REGEX =
  /\d{4}\.\d{2}\.\d{2}_\d{2}\.\d{2}\.\d{2}:\s*(.+?)\s*\[UniqueNetId:([0-9a-fA-F]+)\s*Platform:[^\]]*\]\s*(joined|left) this ARK!/i

/** Pure parser: extracts every join/leave event from a chunk of ShooterGame.log content. */
export function parsePlayerConnectionEvents(chunk: string): PlayerConnectionEvent[] {
  const events: PlayerConnectionEvent[] = []
  for (const line of chunk.split(/\r?\n/)) {
    const match = line.match(LINE_REGEX)
    if (!match) continue
    const [, playerName, uniqueNetId, verb] = match
    events.push({
      type: verb.toLowerCase() === 'joined' ? 'joined' : 'left',
      playerName: playerName.trim(),
      uniqueNetId: uniqueNetId.toLowerCase()
    })
  }
  return events
}

/**
 * Continuously tails the server's log for player join/leave lines for as long as the
 * server runs (unlike watchLogFileForMarker, this doesn't stop after the first match).
 * Returns a function that stops watching.
 */
export function watchPlayerConnectionEvents(
  installDir: string,
  onEvent: (event: PlayerConnectionEvent) => void,
  intervalMs = 2000
): () => void {
  return watchLogFile(
    installDir,
    (chunk) => {
      for (const event of parsePlayerConnectionEvents(chunk)) onEvent(event)
    },
    intervalMs
  )
}
