import fs from 'node:fs'
import path from 'node:path'
import ini from 'ini'
import type { IniTemplateApplyResult, IniTemplateContent, ServerProfile } from '@shared/types'
import { listProfiles, getIniTemplateGeneric, getIniTemplateOverride, recordConfigFileHistory } from '../store'
import { resolveConfigDir } from './config'
import { upsertIniKeys, writeServerSpecificBlock, type IniUpsertEntry } from './gameConfigWrite'

/**
 * INI Templates - a cluster-wide "generic" template is merged in place into each profile's
 * real GameUserSettings.ini/Game.ini as a surgical upsert (see upsertIniKeys): any line that
 * isn't covered by it, including something the user wrote in by hand, is left completely
 * untouched. A profile's own "override" (the genuinely server-specific lines) is instead
 * appended as a dedicated block behind a `;Server Specific INI` comment at the end of the
 * file (see writeServerSpecificBlock) - the same convention ARK server owners already use by
 * hand, since a later `key=value` wins over an earlier one with the same key. SessionName is
 * always force-set to the profile's own name as part of the generic pass, and stripped out
 * of the override if present there too (see stripSessionName), so a server's display name
 * is controlled by the Manager alone, never by anything pasted or imported into a template.
 */

/** The `ini` package expands a dotted section name into nested objects by default (e.g.
 *  "[/script/shootergame.shootergamemode]" parses as
 *  `{ '/script/shootergame': { shootergamemode: {...} } }`) unless each dot is escaped -
 *  but that exact section name is where most of a server's own rule/rate multipliers live
 *  in Game.ini, always written with a plain, unescaped dot, and is meant to be taken as one
 *  flat literal string. Escaping every dot inside each `[...]` header before parsing keeps
 *  the result's section keys exactly matching what's actually written in the file. */
function escapeSectionDots(text: string): string {
  return text.replace(/^[ \t]*\[([^\]]*)\][ \t]*$/gm, (_match, section: string) => `[${section.replace(/\./g, '\\.')}]`)
}

function parseTemplateText(text: string, label: string): Record<string, unknown> {
  if (!text.trim()) return {}
  try {
    return ini.parse(escapeSectionDots(text))
  } catch (err) {
    throw new Error(`${label} is not valid INI: ${(err as Error).message}`)
  }
}

/** Flattens a parsed ini object ({section: {key: value}}) into a flat entry list. Only one
 *  level of section nesting is handled - GameUserSettings.ini/Game.ini never nest deeper
 *  than `[Section]` key=value, and a sectionless top-level key (ini.parse puts those
 *  directly on the root as a plain value, not an object) never legitimately appears in
 *  either file, so it's silently skipped rather than guessed at. */
function flatten(parsed: Record<string, unknown>): IniUpsertEntry[] {
  const entries: IniUpsertEntry[] = []
  for (const [section, body] of Object.entries(parsed)) {
    if (!body || typeof body !== 'object') continue
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      entries.push({ section, key, value: String(value) })
    }
  }
  return entries
}

/** The server's display name is owned entirely by its profile in the Manager, never by a
 *  template - dropped from the override before it's written so a pasted/imported override
 *  file that happens to carry its own SessionName (very likely, since that's an ordinary
 *  line in any real GameUserSettings.ini) can never win over the forced one. Doing this here
 *  rather than relying on write order matters because the override is written in its own
 *  trailing block (see writeServerSpecificBlock) - physically after the forced SessionName
 *  upsertIniKeys already placed higher in the file, so an un-stripped override SessionName
 *  would otherwise be the file's last occurrence of that key and win under ARK's own
 *  last-value-wins ini parsing. */
function stripSessionName(entries: IniUpsertEntry[]): IniUpsertEntry[] {
  return entries.filter((entry) => !(entry.section.toLowerCase() === 'sessionsettings' && entry.key.toLowerCase() === 'sessionname'))
}

function snapshotBeforeApply(profileId: string, installDir: string, filePath: string): void {
  try {
    const previous = fs.readFileSync(filePath, 'utf-8')
    // Keyed the same way the Files tab's own editor/history already does (fileBrowser.ts,
    // relative to installDir) - so an Apply shows up in that same history/diff view
    // alongside any manual edit, instead of a separate list nothing else reads.
    recordConfigFileHistory(profileId, path.relative(installDir, filePath), previous)
  } catch {
    // No existing file yet (fresh install never started) - nothing to snapshot.
  }
}

function buildGeneric(generic: IniTemplateContent): { gus: IniUpsertEntry[]; game: IniUpsertEntry[] } {
  return {
    gus: flatten(parseTemplateText(generic.gameUserSettingsIni, 'Generic GameUserSettings.ini')),
    game: flatten(parseTemplateText(generic.gameIni, 'Generic Game.ini'))
  }
}

/** Applies the generic template plus `profile`'s own override to its real config files.
 *  Throws (with a message naming which template/file was the problem) on invalid INI text or
 *  a write failure (e.g. the config dir is locked read-only while the server's running). */
export function applyIniTemplate(profile: ServerProfile): void {
  const generic = buildGeneric(getIniTemplateGeneric())
  const override = getIniTemplateOverride(profile.id)
  const overrideGus = stripSessionName(
    flatten(parseTemplateText(override?.gameUserSettingsIni ?? '', `${profile.name}'s GameUserSettings.ini override`))
  )
  const overrideGame = flatten(parseTemplateText(override?.gameIni ?? '', `${profile.name}'s Game.ini override`))

  // Always wins, regardless of what either template says for this one key - see this
  // module's own doc comment.
  const gusEntries = [...generic.gus, { section: 'SessionSettings', key: 'SessionName', value: profile.name }]
  const gameEntries = generic.game

  const configDir = resolveConfigDir(profile.installDir)
  const gusPath = path.join(configDir, 'GameUserSettings.ini')
  const gamePath = path.join(configDir, 'Game.ini')

  try {
    snapshotBeforeApply(profile.id, profile.installDir, gusPath)
    upsertIniKeys(gusPath, gusEntries)
    writeServerSpecificBlock(gusPath, overrideGus)
  } catch (err) {
    throw new Error(`GameUserSettings.ini: ${(err as Error).message}`)
  }

  if (gameEntries.length > 0 || overrideGame.length > 0) {
    try {
      snapshotBeforeApply(profile.id, profile.installDir, gamePath)
      upsertIniKeys(gamePath, gameEntries)
      writeServerSpecificBlock(gamePath, overrideGame)
    } catch (err) {
      throw new Error(`Game.ini: ${(err as Error).message}`)
    }
  }
}

/** Same as applyIniTemplate, for every ARK profile at once - never rejects itself, each
 *  profile's own outcome is reported in the returned array instead, so one bad override
 *  doesn't stop the rest of the cluster from being applied. */
export function applyIniTemplateToAll(): IniTemplateApplyResult[] {
  const arkProfiles = listProfiles()
  return arkProfiles.map((profile) => {
    try {
      applyIniTemplate(profile)
      return { profileId: profile.id, profileName: profile.name, ok: true }
    } catch (err) {
      return { profileId: profile.id, profileName: profile.name, ok: false, error: (err as Error).message }
    }
  })
}
