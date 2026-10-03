import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Admin-controlled switches. The authoritative file lives in a system folder only
// administrators can write, and which an update/reinstall of the app does not touch
// (the install folder is wiped on every update). The env var suits managed launchers,
// and a policy.json in the app's resources folder is still honoured.
// A policy file we cannot parse is treated as "locked down", never as "absent".
export function policyFiles({ platform = process.platform, env = process.env, resourcesDir }) {
  const system = {
    win32: join(env.ProgramData ?? 'C:\\ProgramData', 'DataLad Desktop', 'policy.json'),
    darwin: '/Library/Application Support/DataLad Desktop/policy.json'
  }[platform] ?? '/etc/datalad-desktop/policy.json'
  return [system, join(resourcesDir, 'policy.json')]
}

export function loadPolicy({ env = process.env, files = [] }) {
  const consoleDisabled = files.some((file) => {
    try {
      return JSON.parse(readFileSync(file, 'utf8')).consoleDisabled === true
    } catch (error) {
      return error.code !== 'ENOENT'
    }
  })
  return { consoleDisabled: env.DATALAD_DESKTOP_DISABLE_CONSOLE === '1' || consoleDisabled }
}
