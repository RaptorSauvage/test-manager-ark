import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generate } from 'selfsigned'
import { getDataDir } from './dataDir'

function getCertsDir(): string {
  return path.join(getDataDir(), 'certs')
}

/** Non-internal IPv4 addresses of this machine - duplicated here (rather than imported
 *  from webDashboard.ts, which already has an identical helper) to avoid a circular
 *  import, since webDashboard.ts is what calls into this module. */
function getLocalIps(): string[] {
  const ips: string[] = []
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const addr of addresses ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address)
    }
  }
  return ips
}

interface CertMeta {
  sanIps: string[]
}

function readMeta(metaPath: string): CertMeta | null {
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8')) as CertMeta
  } catch {
    return null
  }
}

/** Loads the cached self-signed cert/key for the web dashboard's HTTPS mode, generating a
 *  fresh one if none exists yet or if this machine's local IPs have changed since it was
 *  generated (DHCP reassignment) - regenerating just avoids an extra "hostname mismatch"
 *  warning on top of the unavoidable "not trusted" one every self-signed cert gets; it's
 *  not a security boundary; the browser warning appears either way. */
export function getOrCreateCert(): { key: string; cert: string } {
  const certsDir = getCertsDir()
  const keyPath = path.join(certsDir, 'key.pem')
  const certPath = path.join(certsDir, 'cert.pem')
  const metaPath = path.join(certsDir, 'certmeta.json')

  const currentIps = getLocalIps().sort()
  const meta = readMeta(metaPath)
  const isCached = fs.existsSync(keyPath) && fs.existsSync(certPath) && meta !== null
  const sanUnchanged = isCached && JSON.stringify(meta!.sanIps) === JSON.stringify(currentIps)

  if (isCached && sanUnchanged) {
    return { key: fs.readFileSync(keyPath, 'utf8'), cert: fs.readFileSync(certPath, 'utf8') }
  }

  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    ...currentIps.map((ip) => ({ type: 7, ip }))
  ]

  const pems = generate([{ name: 'commonName', value: 'ark-server-manager.local' }], {
    days: 3650,
    keySize: 2048,
    extensions: [
      { name: 'basicConstraints', cA: true },
      {
        name: 'keyUsage',
        keyCertSign: true,
        digitalSignature: true,
        nonRepudiation: true,
        keyEncipherment: true,
        dataEncipherment: true
      },
      { name: 'subjectAltName', altNames }
    ]
  })

  fs.mkdirSync(certsDir, { recursive: true })
  fs.writeFileSync(keyPath, pems.private)
  fs.writeFileSync(certPath, pems.cert)
  fs.writeFileSync(metaPath, JSON.stringify({ sanIps: currentIps } satisfies CertMeta))

  return { key: pems.private, cert: pems.cert }
}
