import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

// Admin-controlled settings (pre-trusted folders). The authoritative file lives in a system folder only
// administrators can write, and which an update/reinstall of the app does not touch
// (the install folder is wiped on every update); a policy.json in the app's resources folder is still honoured.
// trustedRoots: absolute folders an administrator pre-trusts, e.g. a lab share. A file we cannot parse names none.
// runDisabled: turns Run & record off. The env var suits managed launchers; a policy file that exists but cannot be
// read is "locked down", never "absent" (fail closed).
// updateCheckDisabled: turns the update checks (the prism-validator update and the DataLad/git-annex notices) off; env var DATALAD_DESKTOP_DISABLE_UPDATE_CHECK=1,
// same fail-closed rule as runDisabled.
export function policyFiles({ platform = process.platform, env = process.env, resourcesDir }) {
  const system = {
    win32: join(env.ProgramData ?? 'C:\\ProgramData', 'DataLad Desktop', 'policy.json'),
    darwin: '/Library/Application Support/DataLad Desktop/policy.json'
  }[platform] ?? '/etc/datalad-desktop/policy.json'
  return [system, join(resourcesDir, 'policy.json')]
}

export function loadPolicy({ env = process.env, files = [] }) {
  let runDisabled = env.DATALAD_DESKTOP_DISABLE_RUN === '1'
  let updateCheckDisabled = env.DATALAD_DESKTOP_DISABLE_UPDATE_CHECK === '1'
  const trustedRoots = new Set()
  for (const file of files) {
    let parsed
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      runDisabled ||= error.code !== 'ENOENT'
      updateCheckDisabled ||= error.code !== 'ENOENT'
      continue // an unreadable file names no trusted roots
    }
    runDisabled ||= parsed?.runDisabled === true
    updateCheckDisabled ||= parsed?.updateCheckDisabled === true
    for (const root of Array.isArray(parsed?.trustedRoots) ? parsed.trustedRoots : []) {
      if (typeof root === 'string' && isAbsolute(root)) {
        trustedRoots.add(root)
      }
    }
  }
  return { trustedRoots: [...trustedRoots], runDisabled, updateCheckDisabled }
}
