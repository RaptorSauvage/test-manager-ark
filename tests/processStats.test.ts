import { describe, expect, it, vi, beforeEach } from 'vitest'

// getProcessStats only bypasses pidusage's own (unreliable) wmic-vs-gwmi dispatch on
// Windows - pin the platform here so this file can exercise that branch, independent of
// whatever OS actually runs the test suite.
vi.mock('node:process', () => ({ platform: 'win32' }))

const mockWmic = vi.fn()
const mockGwmi = vi.fn()
vi.mock('pidusage/lib/wmic', () => ({ default: (...args: unknown[]) => mockWmic(...args) }))
vi.mock('pidusage/lib/gwmi', () => ({ default: (...args: unknown[]) => mockGwmi(...args) }))
vi.mock('pidusage', () => ({ default: vi.fn() }))

import { getProcessStats } from '../src/main/lib/processStats'

function succeed(mock: ReturnType<typeof vi.fn>, stats: Record<number, { cpu: number; memory: number }>): void {
  mock.mockImplementation(
    (_pids: number[], _options: unknown, done: (err: Error | null, stats: typeof stats) => void) => done(null, stats)
  )
}

function fail(mock: ReturnType<typeof vi.fn>, err: Error): void {
  mock.mockImplementation((_pids: number[], _options: unknown, done: (err: Error | null) => void) => done(err))
}

beforeEach(() => {
  mockWmic.mockReset()
  mockGwmi.mockReset()
})

describe('getProcessStats on Windows', () => {
  it('uses wmic when it works, without ever touching the PowerShell fallback', async () => {
    succeed(mockWmic, { 4242: { cpu: 3.5, memory: 100 * 1024 * 1024 } })

    await expect(getProcessStats(4242)).resolves.toEqual({ cpu: 3.5, memory: 100 * 1024 * 1024 })
    expect(mockGwmi).not.toHaveBeenCalled()
  })

  it('falls back to the PowerShell (gwmi) implementation when wmic fails', async () => {
    fail(mockWmic, new Error('spawn wmic ENOENT'))
    succeed(mockGwmi, { 4242: { cpu: 7.1, memory: 200 * 1024 * 1024 } })

    await expect(getProcessStats(4242)).resolves.toEqual({ cpu: 7.1, memory: 200 * 1024 * 1024 })
  })

  it('remembers the fallback and skips wmic entirely on later calls', async () => {
    fail(mockWmic, new Error('spawn wmic ENOENT'))
    succeed(mockGwmi, { 4242: { cpu: 1, memory: 1024 } })
    await getProcessStats(4242)

    mockWmic.mockReset()
    succeed(mockGwmi, { 4242: { cpu: 2, memory: 2048 } })

    await expect(getProcessStats(4242)).resolves.toEqual({ cpu: 2, memory: 2048 })
    expect(mockWmic).not.toHaveBeenCalled()
  })

  it('propagates the error when the PowerShell fallback also fails', async () => {
    fail(mockWmic, new Error('spawn wmic ENOENT'))
    fail(mockGwmi, new Error('powershell.exe is not recognized'))

    await expect(getProcessStats(4242)).rejects.toThrow('powershell.exe is not recognized')
  })
})
