import { describe, expect, it } from 'vitest'
import { selectBackupsToPrune } from '../src/main/lib/backup'
import type { BackupEntry } from '../shared/types'

function entry(fileName: string, createdAt: number): BackupEntry {
  return { fileName, filePath: `/backups/${fileName}`, createdAt, sizeBytes: 1024 }
}

describe('selectBackupsToPrune', () => {
  it('keeps the newest N backups and prunes the rest', () => {
    const backups = [entry('a', 1), entry('b', 3), entry('c', 2), entry('d', 4)]
    const toPrune = selectBackupsToPrune(backups, 2)
    expect(toPrune.map((b) => b.fileName)).toEqual(['c', 'a'])
  })

  it('prunes nothing when under the limit', () => {
    const backups = [entry('a', 1), entry('b', 2)]
    expect(selectBackupsToPrune(backups, 5)).toEqual([])
  })

  it('treats a non-positive maxBackups as "no limit" and prunes nothing', () => {
    const backups = [entry('a', 1)]
    expect(selectBackupsToPrune(backups, 0)).toEqual([])
    expect(selectBackupsToPrune(backups, -1)).toEqual([])
  })
})
