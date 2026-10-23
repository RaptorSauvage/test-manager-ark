import fs from 'node:fs'
import path from 'node:path'
import type { IniTemplateApplyResult, ServerProfile } from '@shared/types'
import { listProfiles, getIniTemplateGeneric, getIniTemplateOverride, recordConfigFileHistory } from '../store'
import { resolveConfigDir } from './config'
import { writeTrailingSections } from './gameConfigWrite'

/**
 * INI Templates - a cluster-wide "generic" template and a profile's own "override" are each
 * written as their own raw-text block at the end of the real GameUserSettings.ini/Game.ini,
 * behind their own comment marker (see writeTrailingSections) - verbatim, comments and all,
 * rather than parsed into individual `key=value` entries and losing anything that isn't
 * itself a setting. The override's block comes after the generic one, so it wins for any key
 * both define, under the game's own last-value-wins ini parsing - the same convention ARK
 * server owners already use by hand. SessionName is always written as its own block, last of
 * all, forcing the profile's own name regardless of what either template says - a line
 * matching SessionName is also stripped out of both templates before they're written, so an
 * imported file that happens to carry its own SessionName (very likely, since that's an
 * ordinary line in any real GameUserSettings.ini) can never end up physically last and win
 * instead. Everything above the first of these three markers, including anything the user
 * wrote in by hand before ever using this tool, is left completely untouched.
 */

const GENERIC_MARKER = ';Generic Template (Bober Server Manager)'
const OVERRIDE_MARKER = ';Server Specific INI'
const NAME_MARKER = ';Server Name (set by Bober Server Manager - do not edit)'

function stripSessionNameLines(text: string): string {
  return text
    .split(/\r\n|\n/)
    .filter((line) => !/^\s*SessionName\s*=/i.test(line))
    .join('\n')
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

/** Applies the generic template plus `profile`'s own override to its real config files.
 *  Throws (with a message naming which file was the problem) on a write failure (e.g. the
 *  config dir is locked read-only while the server's running). */
export function applyIniTemplate(profile: ServerProfile): void {
  const generic = getIniTemplateGeneric()
  const override = getIniTemplateOverride(profile.id)

  const configDir = resolveConfigDir(profile.installDir)
  const gusPath = path.join(configDir, 'GameUserSettings.ini')
  const gamePath = path.join(configDir, 'Game.ini')

  try {
    snapshotBeforeApply(profile.id, profile.installDir, gusPath)
    writeTrailingSections(gusPath, [
      { marker: GENERIC_MARKER, body: stripSessionNameLines(generic.gameUserSettingsIni) },
      { marker: OVERRIDE_MARKER, body: stripSessionNameLines(override?.gameUserSettingsIni ?? '') },
      { marker: NAME_MARKER, body: `[SessionSettings]\nSessionName=${profile.name}` }
    ])
  } catch (err) {
    throw new Error(`GameUserSettings.ini: ${(err as Error).message}`)
  }

  try {
    snapshotBeforeApply(profile.id, profile.installDir, gamePath)
    writeTrailingSections(gamePath, [
      { marker: GENERIC_MARKER, body: generic.gameIni },
      { marker: OVERRIDE_MARKER, body: override?.gameIni ?? '' }
    ])
  } catch (err) {
    throw new Error(`Game.ini: ${(err as Error).message}`)
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
