/**
 * CurseForge identifies an already-downloaded file by its own "fingerprint" - not a standard
 * file hash, but MurmurHash2 (32-bit, seed 1) computed over the file's bytes with whitespace
 * bytes (tab/LF/CR/space) stripped out first. This is CurseForge's own published algorithm
 * (used by their official app and every third-party launcher that supports CurseForge mods -
 * e.g. the Minecraft launchers that query POST /v1/fingerprints the same way
 * curseforgeClient.ts's getCurseForgeFingerprintMatches does), not something invented here.
 */

/** Strips the four whitespace byte values CurseForge's algorithm ignores before hashing -
 *  matches the published reference implementation exactly (not "any whitespace", just these
 *  four particular byte values). */
function stripWhitespaceBytes(buffer: Buffer): Buffer {
  const filtered = Buffer.alloc(buffer.length)
  let length = 0
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i]
    if (byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x20) {
      filtered[length++] = byte
    }
  }
  return filtered.subarray(0, length)
}

/** The original 32-bit MurmurHash2 (Austin Appleby's reference algorithm) - CurseForge uses
 *  this exact variant (not MurmurHash2A, not Murmur3) with a fixed seed of 1. Uses
 *  Math.imul for 32-bit-wrapping multiplication (JS numbers aren't 32-bit integers natively)
 *  and `>>> 0` throughout to keep every intermediate value an unsigned 32-bit integer, the
 *  same semantics as the C reference implementation's `uint32_t`. */
function murmur2(data: Buffer, seed: number): number {
  const m = 0x5bd1e995
  const r = 24

  let len = data.length
  let h = (seed ^ len) >>> 0
  let i = 0

  while (len >= 4) {
    let k = data.readUInt32LE(i)

    k = Math.imul(k, m) >>> 0
    k = (k ^ (k >>> r)) >>> 0
    k = Math.imul(k, m) >>> 0

    h = Math.imul(h, m) >>> 0
    h = (h ^ k) >>> 0

    i += 4
    len -= 4
  }

  switch (len) {
    case 3:
      h = (h ^ (data[i + 2] << 16)) >>> 0
    // falls through
    case 2:
      h = (h ^ (data[i + 1] << 8)) >>> 0
    // falls through
    case 1:
      h = (h ^ data[i]) >>> 0
      h = Math.imul(h, m) >>> 0
  }

  h = (h ^ (h >>> 13)) >>> 0
  h = Math.imul(h, m) >>> 0
  h = (h ^ (h >>> 15)) >>> 0

  return h >>> 0
}

/** Computes a CurseForge fingerprint for a file's raw bytes - pass straight to
 *  getCurseForgeFingerprintMatches (batched across many files in one call). */
export function computeCurseForgeFingerprint(buffer: Buffer): number {
  return murmur2(stripWhitespaceBytes(buffer), 1)
}
