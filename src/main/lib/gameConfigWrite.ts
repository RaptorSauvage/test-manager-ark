import fs from 'node:fs'
import path from 'node:path'
import type { ServerProfile } from '@shared/types'
import { resolveConfigDir } from './config'

/**
 * Surgical writes into GameUserSettings.ini/Game.ini - unlike config.ts (which only ever
 * reads these, since they're files the user manages and hand-edits themselves), ARK:
 * Survival Evolved has no command-line mechanism for mods at all (see buildLaunchArgs) - the
 * only way the Manager can make a Mods tab change actually apply is to write ActiveMods= and
 * the [ModInstaller] block itself.
 *
 * Both functions below edit the raw text line-by-line rather than parsing the whole file with
 * the `ini` package and re-stringifying it, which would reorder/reformat every other section,
 * comment and key the user has in the file - these touch only the lines that belong to the
 * one key (or run of repeated keys) they're asked to update.
 */

function detectEol(content: string): string {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

/** The Config/WindowsServer folder doesn't necessarily exist yet - e.g. a profile created
 *  for a fresh SteamCMD install that hasn't been started once yet - and a plain
 *  writeFileSync would fail with ENOENT in that case. */
function writeFileEnsuringDir(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf-8')
}

function findSectionRange(lines: string[], section: string): { start: number; end: number } | null {
  const sectionLine = `[${section}]`
  const start = lines.findIndex((line) => line.trim() === sectionLine)
  if (start === -1) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[.*\]\s*$/.test(lines[i])) {
      end = i
      break
    }
  }
  return { start, end }
}

/**
 * Replaces (or inserts) a single `key=value` line inside `[section]`, leaving every other
 * line untouched. Creates the section, appended at the end of the file, if it doesn't exist
 * yet.
 */
export function upsertIniKey(filePath: string, section: string, key: string, value: string): void {
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : ''
  const eol = content ? detectEol(content) : '\r\n'
  const lines = content.length > 0 ? content.split(/\r\n|\n/) : []
  const keyPattern = new RegExp(`^\\s*${key}\\s*=`)

  const range = findSectionRange(lines, section)
  if (!range) {
    const prefix = lines.length > 0 && lines[lines.length - 1] !== '' ? eol : ''
    writeFileEnsuringDir(filePath, content + prefix + `[${section}]${eol}${key}=${value}${eol}`)
    return
  }

  const existingIndex = lines.slice(range.start + 1, range.end).findIndex((line) => keyPattern.test(line))
  if (existingIndex !== -1) {
    lines[range.start + 1 + existingIndex] = `${key}=${value}`
  } else {
    lines.splice(range.start + 1, 0, `${key}=${value}`)
  }
  writeFileEnsuringDir(filePath, lines.join(eol))
}

/**
 * Same idea, but for a key that appears multiple times in a row (Game.ini's [ModInstaller]
 * `ModIDS=` lines) - replaces the whole run of `key=` lines inside `[section]` with one line
 * per entry in `values`, in order. An empty `values` removes the run entirely rather than
 * leaving a stray empty line. Creates the section (appended at the end) only if `values` is
 * non-empty - nothing to write otherwise.
 */
export function upsertIniRepeatedKey(filePath: string, section: string, key: string, values: string[]): void {
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : ''
  const eol = content ? detectEol(content) : '\r\n'
  const lines = content.length > 0 ? content.split(/\r\n|\n/) : []
  const keyPattern = new RegExp(`^\\s*${key}\\s*=`)
  const newLines = values.map((v) => `${key}=${v}`)

  const range = findSectionRange(lines, section)
  if (!range) {
    if (newLines.length === 0) return
    const prefix = lines.length > 0 && lines[lines.length - 1] !== '' ? eol : ''
    writeFileEnsuringDir(filePath, content + prefix + `[${section}]${eol}${newLines.join(eol)}${eol}`)
    return
  }

  const sectionLines = lines.slice(range.start + 1, range.end)
  const matchIndices = sectionLines.reduce<number[]>((acc, line, i) => {
    if (keyPattern.test(line)) acc.push(i)
    return acc
  }, [])

  if (matchIndices.length === 0) {
    if (newLines.length > 0) lines.splice(range.start + 1, 0, ...newLines)
  } else {
    const insertAt = range.start + 1 + matchIndices[0]
    // Remove every matching line (highest index first, so earlier removals don't shift the
    // indices of the ones still to come), then insert the fresh block at the first one's spot.
    for (let i = matchIndices.length - 1; i >= 0; i--) {
      lines.splice(range.start + 1 + matchIndices[i], 1)
    }
    lines.splice(insertAt, 0, ...newLines)
  }
  writeFileEnsuringDir(filePath, lines.join(eol))
}

/**
 * ARK: Survival Evolved's only mechanism for mods - writes the enabled mod ids, in order,
 * to GameUserSettings.ini's `ActiveMods=` (comma-separated) and Game.ini's `[ModInstaller]`
 * block (one `ModIDS=<id>` line per mod). Passive/dev don't exist for this game (see
 * shared/types.ts's ServerMod), so every enabled mod counts, full stop. Called from
 * ipc/mods.ts whenever the Mods tab saves for an ARK: Survival Evolved profile - a no-op for
 * ARK: Survival Ascended, which has no such need (its mods are launch-flag only).
 */
export function syncAseModsToIni(profile: ServerProfile): void {
  if (profile.game !== 'ark-evolved') return
  const modIds = profile.mods.filter((mod) => mod.enabled).map((mod) => mod.id)
  const configDir = resolveConfigDir(profile.installDir)
  upsertIniKey(path.join(configDir, 'GameUserSettings.ini'), 'ServerSettings', 'ActiveMods', modIds.join(','))
  upsertIniRepeatedKey(path.join(configDir, 'Game.ini'), 'ModInstaller', 'ModIDS', modIds)
}
