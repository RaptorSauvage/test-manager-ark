import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import type { ManagerLogEntry } from '@shared/types'
import { getDataDir } from './dataDir'

/** Emits 'log' with the new ManagerLogEntry every time one is recorded, so the Manager Log
 *  view can append live instead of re-fetching/polling the whole file. */
export const managerLogEvents = new EventEmitter()

/** Fixed rolling-window cap - unlike the per-server cluster log archive, this isn't a
 *  per-profile setting; it's Manager-wide activity, expected to accumulate slowly enough
 *  that a single generous fixed size never needs tuning per install. */
const MAX_BYTES = 5 * 1024 * 1024

function getManagerLogPath(): string {
  return path.join(getDataDir(), 'logs', 'manager.jsonl')
}

let sequence = 0

/** A fresh id for a new task instance - pass the same one to every logManagerEvent() call
 *  that belongs to the same task run, so they're grouped together under one header. */
export function newTaskId(prefix: string): string {
  sequence += 1
  return `${prefix}-${Date.now()}-${sequence}`
}

function nowAsLogDateTime(): { date: string; ts: string } {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return {
    date: `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`,
    ts: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  }
}

export function logManagerEvent(taskId: string, taskLabel: string, message: string, level: 'info' | 'error' = 'info'): void {
  sequence += 1
  const entry: ManagerLogEntry = {
    id: `${Date.now()}-${sequence}`,
    ...nowAsLogDateTime(),
    taskId,
    taskLabel,
    message,
    level
  }

  const logPath = getManagerLogPath()
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n')

  const { size } = fs.statSync(logPath)
  if (size > MAX_BYTES) {
    const buffer = Buffer.alloc(MAX_BYTES)
    const fd = fs.openSync(logPath, 'r')
    try {
      fs.readSync(fd, buffer, 0, MAX_BYTES, size - MAX_BYTES)
    } finally {
      fs.closeSync(fd)
    }
    let text = buffer.toString('utf-8')
    const firstNewline = text.indexOf('\n')
    if (firstNewline >= 0) text = text.slice(firstNewline + 1)
    fs.writeFileSync(logPath, text)
  }

  managerLogEvents.emit('log', entry)
}

export function readManagerLog(): ManagerLogEntry[] {
  const logPath = getManagerLogPath()
  if (!fs.existsSync(logPath)) return []
  const entries: ManagerLogEntry[] = []
  for (const line of fs.readFileSync(logPath, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (parsed && typeof parsed === 'object' && 'taskId' in parsed && 'message' in parsed) {
        entries.push(parsed as ManagerLogEntry)
      }
    } catch {
      // Skip a corrupt/truncated line rather than losing the whole log to it.
    }
  }
  return entries
}
