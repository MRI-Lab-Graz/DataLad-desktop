import { readFileSync } from 'node:fs'

// Admin-controlled switches. The file lives in the install's resources folder
// (admin-writable on a per-machine install); the env var suits managed launchers.
// A policy file we cannot parse is treated as "locked down", never as "absent".
export function loadPolicy({ env = process.env, file }) {
  let fromFile = {}
  try {
    fromFile = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') {
      fromFile = { consoleDisabled: true }
    }
  }
  return {
    consoleDisabled: env.DATALAD_DESKTOP_DISABLE_CONSOLE === '1' || fromFile.consoleDisabled === true
  }
}
