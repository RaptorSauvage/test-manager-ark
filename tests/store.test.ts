import { describe, expect, it, vi } from 'vitest'
import Store from 'electron-store'
import { setRunningPid, setRunningStartedAt, getRunningPids, getRunningStartedAt } from '../src/main/store'

describe('setRunningPid/setRunningStartedAt', () => {
  it('persists normally when nothing goes wrong', () => {
    setRunningPid('resilience-test-normal', 4242)
    expect(getRunningPids()['resilience-test-normal']).toBe(4242)
    setRunningPid('resilience-test-normal', null)
    expect(getRunningPids()['resilience-test-normal']).toBeUndefined()
  })

  it('never throws when the underlying disk write fails - a real report on Windows had this skip the emitStatus() call right after it', () => {
    // finalizeStopped/startServer in serverProcess.ts call setRunningPid/setRunningStartedAt
    // immediately before emitStatus() - the one call that actually updates the renderer's
    // view of a server's state. If either threw, emitStatus() would never run, leaving a
    // server stuck showing the wrong state in the UI even though the Manager's own internal
    // tracking had already moved on (see the fix's own comment in store.ts).
    const spy = vi.spyOn(Store.prototype, 'set').mockImplementation(() => {
      throw Object.assign(new Error('unknown error, write'), { code: 'UNKNOWN', errno: -4094 })
    })
    try {
      expect(() => setRunningPid('resilience-test-throw', 1234)).not.toThrow()
      expect(() => setRunningStartedAt('resilience-test-throw', Date.now())).not.toThrow()
    } finally {
      spy.mockRestore()
    }
  })
})
