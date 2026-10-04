import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { NOT_FULLY_SCANNED } from './folder-trust.js'

// The real path with the file system's own capitalisation (macOS and Windows ignore case), so
// every spelling of a folder is the same key.
const canonical = (path) => {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}
const inside = (child, root) => child === root || child.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
const unscanned = (vector) => vector.startsWith(NOT_FULLY_SCANNED)

// Inode and creation time: if the folder at a path is a different one now (another USB stick, a
// re-extracted archive) the user is asked again. No usable inode (some network shares): no check.
export function identityOf(path) {
  try {
    const stat = statSync(path, { bigint: true })
    return stat.ino === 0n ? null : { ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) }
  } catch {
    return null
  }
}
const sameIdentity = (a, b) => a.ino === b.ino && a.birthtimeNs === b.birthtimeNs

function readRecords(file) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {} // first run, or unreadable: ask again
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {} // version 0, a plain list of paths: trusts nothing
  }
  if (parsed.version === 2 && parsed.records && typeof parsed.records === 'object') {
    return Object.fromEntries(
      Object.entries(parsed.records)
        .filter(([, record]) => record && (record.scope === 'folder' || record.scope === 'tree'))
        .map(([path, record]) => [path, { scope: record.scope, findings: Array.isArray(record.findings) ? record.findings : [], identity: record.identity ?? null }])
    )
  }
  // version 1: { path: [accepted findings] }, exactly the folders the user was asked about
  return Object.fromEntries(
    Object.entries(parsed).filter(([, findings]) => Array.isArray(findings)).map(([path, findings]) => [path, { scope: 'folder', findings, identity: null }])
  )
}

// What the user trusted, per folder (this folder, and the findings they saw) or per tree (everything inside),
// plus the locations an administrator pre-trusted. See the spec for the rules.
export function createTrustStore({ file, adminRoots = [] }) {
  const roots = adminRoots.map(canonical)
  const records = readRecords(file)
  const thisLaunch = new Map()
  const persist = () => {
    try {
      writeFileSync(file, JSON.stringify({ version: 2, records }))
    } catch {
      // unwritable: trust holds for this launch only
    }
  }
  return {
    covers(path) {
      const key = canonical(path)
      return roots.some((root) => inside(key, root)) || Object.entries(records).some(([trusted, record]) => record.scope === 'tree' && inside(key, trusted))
    },
    decide(path, vectors) {
      const key = canonical(path)
      const record = records[key]
      if (record?.scope !== 'folder') {
        return { trusted: false }
      }
      const launch = thisLaunch.get(key)
      if (!vectors.every((vector) => record.findings.includes(vector) || launch?.has(vector))) {
        return { trusted: false }
      }
      const now = identityOf(key)
      if (record.identity && now && !sameIdentity(record.identity, now)) {
        return { trusted: false }
      }
      if (!record.identity && now) {
        record.identity = now
        persist()
      }
      return { trusted: true }
    },
    trust(path, { scope, vectors = [] }) {
      const key = canonical(path)
      records[key] = { scope, findings: vectors.filter((vector) => !unscanned(vector)), identity: scope === 'folder' ? identityOf(key) : null }
      thisLaunch.set(key, new Set(vectors.filter(unscanned)))
      persist()
    }
  }
}
