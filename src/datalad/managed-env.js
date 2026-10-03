import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// One place to bump versions; changing `packages` makes ensureEnv reinstall.
export const MANAGED_ENV = { python: '3.12', packages: ['prism-validator==0.0.0'] }

const MARKER = 'managed-env.json'
const exe = (name, platform) => (platform === 'win32' ? `${name}.exe` : name)
const sameConfig = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const firstLine = (text) => (text ?? '').split(/\r?\n/, 1)[0].trim() || null

export const resolveUv = (baseDir, platform = process.platform) => join(baseDir, 'uv', exe('uv', platform))

export const envBin = (envDir, name, platform = process.platform) =>
  join(envDir, platform === 'win32' ? 'Scripts' : 'bin', exe(name, platform))

export async function envStatus({ runner, envDir, platform }) {
  const result = await runner.run(envBin(envDir, 'prism-validator', platform), ['--version'], { timeoutMs: 15000 })
  return result.failed ? { ready: false, validatorVersion: null } : { ready: true, validatorVersion: firstLine(result.stdout || result.stderr) }
}

export async function ensureEnv({ runner, uvPath, envDir, config = MANAGED_ENV, signal, onOutput, platform }) {
  const marker = await readFile(join(envDir, MARKER), 'utf8').then(JSON.parse, () => null)
  if (marker && sameConfig(marker, config)) {
    const status = await envStatus({ runner, envDir, platform })
    if (status.ready) return status
  }

  // A stale, mismatched or half-built env is never patched: start clean.
  await rm(envDir, { recursive: true, force: true })
  const opts = { signal, onOutput }
  const steps = [
    ['venv', ['venv', '--python', config.python, envDir]],
    ['install', ['pip', 'install', '--python', envDir, ...config.packages]]
  ]
  for (const [step, args] of steps) {
    const result = await runner.run(uvPath, args, opts)
    if (result.failed) return fail(envDir, step, result)
  }
  const status = await envStatus({ runner, envDir, platform })
  if (!status.ready) return fail(envDir, 'verify', { stderr: 'prism-validator did not start after install', exitCode: 1 })
  await writeFile(join(envDir, MARKER), JSON.stringify(config))
  return status
}

async function fail(envDir, step, result) {
  await rm(envDir, { recursive: true, force: true })
  return { ready: false, ...(result.cancelled && { cancelled: true }), failure: { step, stderr: result.stderr, exitCode: result.exitCode } }
}

const FAILURES = [
  ['PACKAGE_NOT_FOUND', /not found in the package registry|No matching distribution|there is no version of|no versions of prism-validator/i,
    "The PRISM validator isn't available yet. Please try again later or contact your PRISM administrator."],
  ['OFFLINE', /dns error|failed to fetch|connection (refused|reset|timed out)|network|proxy/i,
    "Couldn't download. Check your internet connection (a university proxy can block this) and try again."],
  ['DISK', /no space left|permission denied|os error (13|28)/i,
    "There isn't enough disk space, or the app isn't allowed to write to its data folder."]
]

export function describeEnvFailure({ failure, cancelled, uvPath }) {
  if (cancelled) return { code: 'CANCELLED', message: 'Installation cancelled.' }
  if (failure.exitCode === 127) {
    return { code: 'UV_BLOCKED', message: `The installer helper could not start (${uvPath}). Security software may have blocked it.` }
  }
  const hit = FAILURES.find(([, pattern]) => pattern.test(failure.stderr ?? ''))
  return hit ? { code: hit[0], message: hit[2] } : { code: 'UNKNOWN', message: 'Installing the PRISM validator failed. See technical details.' }
}

export function createEnsureGuard() {
  let busy = false
  return {
    async run(fn) {
      if (busy) throw new Error('Installation already running')
      busy = true
      try { return await fn() } finally { busy = false }
    }
  }
}
