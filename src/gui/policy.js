import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

// Admin-controlled settings (pre-trusted folders). The authoritative file lives in a system folder only
// administrators can write, and which an update/reinstall of the app does not touch
// (the install folder is wiped on every update); a policy.json in the app's resources folder is still honoured.
// trustedRoots: absolute folders an administrator pre-trusts, e.g. a lab share. A file we cannot parse names none.
export function policyFiles({ platform = process.platform, env = process.env, resourcesDir }) {
  const system = {
    win32: join(env.ProgramData ?? 'C:\\ProgramData', 'DataLad Desktop', 'policy.json'),
    darwin: '/Library/Application Support/DataLad Desktop/policy.json'
  }[platform] ?? '/etc/datalad-desktop/policy.json'
  return [system, join(resourcesDir, 'policy.json')]
}

export function loadPolicy({ files = [] }) {
  const trustedRoots = new Set()
  for (const file of files) {
    let parsed
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      continue // an unreadable file names no trusted roots
    }
    for (const root of Array.isArray(parsed?.trustedRoots) ? parsed.trustedRoots : []) {
      if (typeof root === 'string' && isAbsolute(root)) {
        trustedRoots.add(root)
      }
    }
  }
  return { trustedRoots: [...trustedRoots] }
}
