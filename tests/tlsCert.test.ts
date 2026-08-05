import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TEST_DATA_DIR = path.join(os.tmpdir(), `tls-cert-test-${process.pid}`)

vi.mock('../src/main/lib/dataDir', () => ({
  getDataDir: () => TEST_DATA_DIR
}))

import { getOrCreateCert } from '../src/main/lib/tlsCert'

describe('getOrCreateCert', () => {
  beforeEach(() => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true })
  })

  afterEach(() => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true })
  })

  it(
    'generates a cert and key on first call',
    () => {
      const { key, cert } = getOrCreateCert()
      expect(key).toContain('PRIVATE KEY')
      expect(cert).toContain('CERTIFICATE')
      expect(fs.existsSync(path.join(TEST_DATA_DIR, 'certs', 'key.pem'))).toBe(true)
      expect(fs.existsSync(path.join(TEST_DATA_DIR, 'certs', 'cert.pem'))).toBe(true)
      expect(fs.existsSync(path.join(TEST_DATA_DIR, 'certs', 'certmeta.json'))).toBe(true)
    },
    20000
  )

  it(
    'reuses the cached cert on a second call',
    () => {
      const first = getOrCreateCert()
      const second = getOrCreateCert()
      expect(second).toEqual(first)
    },
    20000
  )
})
