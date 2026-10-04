import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

// Admin-controlled switches. The authoritative file lives in a system folder only
// administrators can write, and which an update/reinstall of the app does not touch
// (the install folder is wiped on every update). The env var suits managed launchers,
// and a policy.json in the app's resources folder is still honoured.
// A policy file we cannot parse is treated as "locked down", never as "absent", and names no trusted roots
// (trustedRoots: absolute folders an administrator pre-trusts, e.g. a lab share).
export function policyFiles({ platform = process.platform, env = process.env, resourcesDir }) {
  const system = {
    win32: join(env.ProgramData ?? 'C:\\ProgramData', 'DataLad Desktop', 'policy.json'),
    darwin: '/Library/Application Support/DataLad Desktop/policy.json'
  }[platform] ?? '/etc/datalad-desktop/policy.json'
  return [system, join(resourcesDir, 'policy.json')]
}

export function loadPolicy({ env = process.env, files = [] }) {
  let consoleDisabled = env.DATALAD_DESKTOP_DISABLE_CONSOLE === '1'
  const trustedRoots = new Set()
  for (const file of files) {
    let parsed
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      consoleDisabled ||= error.code !== 'ENOENT' // unreadable is "locked down", never "absent"
      continue // and it names no trusted roots
    }
    consoleDisabled ||= parsed?.consoleDisabled === true
    for (const root of Array.isArray(parsed?.trustedRoots) ? parsed.trustedRoots : []) {
      if (typeof root === 'string' && isAbsolute(root)) {
        trustedRoots.add(root)
      }
    }
  }
  return { consoleDisabled, trustedRoots: [...trustedRoots] }
}
