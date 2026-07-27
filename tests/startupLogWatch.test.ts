import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { computeTailReadStart, watchLogFileForMarker } from '../src/main/lib/serverProcess'

const MARKER = 'READY_MARKER'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('computeTailReadStart', () => {
  it('reads from the previous size when the file has grown', () => {
    expect(computeTailReadStart(100, 250)).toBe(100)
  })

  it('returns null when the size is unchanged', () => {
    expect(computeTailReadStart(100, 100)).toBeNull()
  })

  it('restarts from 0 when the file shrank (rotated/truncated)', () => {
    expect(computeTailReadStart(500, 20)).toBe(0)
  })
})

describe('watchLogFileForMarker', () => {
  let tmpDir: string
  let logPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-log-watch-test-'))
    const logDir = path.join(tmpDir, 'ShooterGame', 'Saved', 'Logs')
    fs.mkdirSync(logDir, { recursive: true })
    logPath = path.join(logDir, 'ShooterGame.log')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('does not fire on content already in the file before watching started', async () => {
    fs.writeFileSync(logPath, `${MARKER}\n`)

    let fired = false
    const stop = watchLogFileForMarker(tmpDir, MARKER, () => (fired = true), 20)
    await wait(150)
    stop()

    expect(fired).toBe(false)
  })

  it('fires once new content containing the marker is appended', async () => {
    fs.writeFileSync(logPath, 'Loading map...\n')

    let fired = false
    const stop = watchLogFileForMarker(tmpDir, MARKER, () => (fired = true), 20)
    await wait(60)
    fs.appendFileSync(logPath, `${MARKER}\n`)
    await wait(150)
    stop()

    expect(fired).toBe(true)
  })

  it('does not fire while the marker is absent', async () => {
    fs.writeFileSync(logPath, 'Loading map...\n')

    let fired = false
    const stop = watchLogFileForMarker(tmpDir, MARKER, () => (fired = true), 20)
    await wait(60)
    fs.appendFileSync(logPath, 'still loading...\n')
    await wait(150)
    stop()

    expect(fired).toBe(false)
  })

  it('handles the log file not existing yet when watching starts', async () => {
    let fired = false
    const stop = watchLogFileForMarker(tmpDir, MARKER, () => (fired = true), 20)
    await wait(60)
    fs.writeFileSync(logPath, 'starting up...\n')
    await wait(60)
    fs.appendFileSync(logPath, `${MARKER}\n`)
    await wait(150)
    stop()

    expect(fired).toBe(true)
  })

  it('stops polling once stop() is called', async () => {
    fs.writeFileSync(logPath, 'Loading map...\n')

    let fired = false
    const stop = watchLogFileForMarker(tmpDir, MARKER, () => (fired = true), 20)
    await wait(40)
    stop()
    fs.appendFileSync(logPath, `${MARKER}\n`)
    await wait(150)

    expect(fired).toBe(false)
  })
})
