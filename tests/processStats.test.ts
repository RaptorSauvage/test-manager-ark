import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

// getProcessStats only shells out to powershell.exe on Windows - pin the platform here so
// this file can exercise that branch, independent of whatever OS actually runs the suite.
vi.mock('node:process', () => ({ platform: 'win32' }))

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
}

const { getFakeChild, setFakeChild } = vi.hoisted(() => {
  let current: FakeChild | undefined
  return {
    getFakeChild: () => current,
    setFakeChild: (c: FakeChild) => {
      current = c
    }
  }
})

const mockSpawn = vi.fn(() => getFakeChild())
vi.mock('node:child_process', () => ({ spawn: (...args: unknown[]) => mockSpawn(...args) }))
vi.mock('pidusage', () => ({ default: vi.fn() }))

import { getProcessStats } from '../src/main/lib/processStats'

/** Queues a fresh fake powershell.exe child that responds with the given stdout/exit code
 *  once its listeners are attached (queueMicrotask runs after runPowerShell's synchronous
 *  listener setup, before this call's own await ever yields). */
function respondWith(stdout: string, exitCode = 0, stderr = ''): void {
  const child = new FakeChild()
  setFakeChild(child)
  queueMicrotask(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout))
    if (stderr) child.stderr.emit('data', Buffer.from(stderr))
    child.emit('close', exitCode)
  })
}

beforeEach(() => {
  mockSpawn.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('getProcessStats on Windows', () => {
  it('invokes powershell.exe with -NoProfile and -ExecutionPolicy Bypass', async () => {
    respondWith('0|104857600')
    await getProcessStats(4242)

    expect(mockSpawn).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining(['-NoProfile', '-ExecutionPolicy', 'Bypass']),
      expect.objectContaining({ windowsHide: true })
    )
  })

  it('parses memory directly and reports 0% cpu on the first reading for a pid', async () => {
    respondWith('12.5|104857600')

    await expect(getProcessStats(9001)).resolves.toEqual({ cpu: 0, memory: 104857600 })
  })

  it('computes a cpu percentage from the delta between two readings', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000_000).mockReturnValueOnce(1_001_000)

    respondWith('10|104857600')
    await getProcessStats(9002)

    respondWith('10.5|104857600')
    const second = await getProcessStats(9002)

    // 0.5s of extra accumulated CPU time over 1s of wall-clock time = 50%.
    expect(second.cpu).toBeCloseTo(50, 5)
  })

  it('rejects with the stderr output when the process no longer exists', async () => {
    respondWith('', 1, 'Get-Process : Cannot find a process with the process ID 4243.')

    await expect(getProcessStats(4243)).rejects.toThrow('Cannot find a process with the process ID 4243')
  })

  it('parses locale-independent (invariant culture) decimal output correctly', async () => {
    // A culture-formatted .ToString() would print "12,5" on a French/European-locale
    // Windows install - the script explicitly forces InvariantCulture, so this
    // period-decimal output is what it should always produce regardless of system locale.
    respondWith('12.5|104857600')

    const result = await getProcessStats(9003)
    expect(result.memory).toBe(104857600)
  })
})
