import fs from 'node:fs'
import path from 'node:path'
import type { FileBrowserListing, ConfigFileHistorySummary } from '@shared/types'
import type { DiffLine } from '@shared/textDiff'
import { computeLineDiff } from '@shared/textDiff'
import { resolveSafePath } from './pathSanitize'
import { listConfigFileHistory, getConfigFileHistoryEntry, recordConfigFileHistory } from '../store'

/**
 * Core file-browser/raw-.ini-editor/config-history logic - shared between the web
 * dashboard's own HTTP routes (webDashboard.ts) and the desktop Manager's IPC handlers
 * (ipc/fileBrowser.ts), so the two surfaces can never quietly disagree on what's safe to
 * read/write/delete. Every function here takes a profile's `installDir` as its own base
 * directory and resolves everything through resolveSafePath - neither caller needs to think
 * about path traversal itself.
 */

/** Whether a path (relative or absolute) ends in `.ini`, case-insensitive - gates the raw
 *  .ini editor functions below so they can't double as a generic arbitrary-file-write
 *  primitive. */
export function isIniPath(p: string): boolean {
  return /\.ini$/i.test(p)
}

export function resolveFileBrowserPath(installDir: string, relativePath: string): string {
  return resolveSafePath(installDir, relativePath)
}

export function listFileBrowserEntries(installDir: string, relativePath: string): FileBrowserListing {
  const dirPath = resolveSafePath(installDir, relativePath)
  const entries = fs.readdirSync(dirPath, { withFileTypes: true }).map((entry) => {
    const stat = fs.statSync(path.join(dirPath, entry.name))
    return { name: entry.name, isDir: entry.isDirectory(), size: stat.size, mtime: stat.mtimeMs }
  })
  return { path: relativePath, entries }
}

/** Deliberately files only - a wrong click deleting one file is recoverable from a backup, a
 *  wrong click recursively deleting a whole folder (SavedArks, say) from a remote web UI (or
 *  a slipped click in the desktop app) is the kind of mistake this browser shouldn't make
 *  easy. */
export function deleteFileBrowserFile(installDir: string, relativePath: string): void {
  const filePath = resolveSafePath(installDir, relativePath)
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) throw new Error('Only files can be deleted here, not folders.')
  fs.unlinkSync(filePath)
}

export function readIniFile(installDir: string, relativePath: string): string {
  if (!isIniPath(relativePath)) throw new Error('Only .ini files can be opened here.')
  const filePath = resolveSafePath(installDir, relativePath)
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) throw new Error('Not a file')
  return fs.readFileSync(filePath, 'utf-8')
}

/** Writing while iniLockEnabled has made the file read-only (see iniLock.ts) fails the same
 *  way any other write to a locked file would - fs throws, the caller surfaces it like any
 *  other failure, nothing ini-lock-specific needed here. */
export function writeIniFile(profileId: string, installDir: string, relativePath: string, content: string): void {
  if (!isIniPath(relativePath)) throw new Error('Only .ini files can be saved here.')
  const filePath = resolveSafePath(installDir, relativePath)
  snapshotIfExists(profileId, filePath, relativePath)
  fs.writeFileSync(filePath, content, 'utf-8')
}

export function listIniHistory(profileId: string, relativePath: string): ConfigFileHistorySummary[] {
  // Only id/savedAt - the full content of every past revision would make this list grow
  // with every edit ever made; a specific revision's content is fetched separately, only
  // once something's actually selected (diffIniHistoryEntry/restoreIniHistoryEntry below).
  return listConfigFileHistory(profileId, relativePath).map((e) => ({ id: e.id, savedAt: e.savedAt }))
}

function requireHistoryEntry(profileId: string, entryId: string): { path: string; content: string } {
  const entry = getConfigFileHistoryEntry(entryId)
  if (!entry || entry.profileId !== profileId) throw new Error('Unknown history entry')
  return entry
}

export function diffIniHistoryEntry(profileId: string, installDir: string, entryId: string): DiffLine[] {
  const entry = requireHistoryEntry(profileId, entryId)
  const filePath = resolveSafePath(installDir, entry.path)
  const current = fs.readFileSync(filePath, 'utf-8')
  const diff = computeLineDiff(entry.content, current)
  if (!diff) throw new Error('This file is too large to diff.')
  return diff
}

/** Restoring is really just another .ini save under the hood - it snapshots whatever's
 *  current right before applying the restored content, the same way any other save does, so
 *  a restore is itself undoable too. */
export function restoreIniHistoryEntry(profileId: string, installDir: string, entryId: string): void {
  const entry = requireHistoryEntry(profileId, entryId)
  const filePath = resolveSafePath(installDir, entry.path)
  snapshotIfExists(profileId, filePath, entry.path)
  fs.writeFileSync(filePath, entry.content, 'utf-8')
}

/** A missing file (first edit ever, nothing to snapshot) is not an error, same as
 *  createBackup's own "nothing to lose" cases elsewhere in this app. */
function snapshotIfExists(profileId: string, filePath: string, relativePath: string): void {
  try {
    const previous = fs.readFileSync(filePath, 'utf-8')
    recordConfigFileHistory(profileId, relativePath, previous)
  } catch {
    // No existing file (or unreadable) - nothing to snapshot, not fatal.
  }
}
