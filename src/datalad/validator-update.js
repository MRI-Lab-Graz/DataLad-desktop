import { mkdir, mkdtemp, readFile, rename as fsRename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MANAGED_ENV, ensureEnv, envBin, envStatus } from './managed-env.js'
import { interpretReport } from './prism-gate.js'

export const PRISM_COOLDOWN_DAYS = 3

export function parseVersion(text) {
  if (typeof text !== 'string') return null
  const v = text.slice(0, 200).match(/\d+(?:\.\d+)+/)?.[0] ?? null
  return v && isSafe(v) ? v : null
}

const isSafe = (v) => v.split('.').every((p) => Number.isSafeInteger(Number(p)))

export function compareVersions(a, b) {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0)
    if (d) return d
  }
  return 0
}

export function pickRelease(pypiJson, { now, cooldownDays }) {
  const releases = pypiJson?.releases
  if (!releases || typeof releases !== 'object' || Array.isArray(releases)) return null
  const cutoffMs = now.getTime() - cooldownDays * 86400000
  let best = null
  for (const [version, files] of Object.entries(releases)) {
    if (!/^\d+(\.\d+)*$/.test(version) || !isSafe(version) || !Array.isArray(files)) continue
    let earliest = Infinity
    for (const f of files) {
      if (!f || f.yanked) continue
      const t = Date.parse(f.upload_time_iso_8601)
      earliest = Number.isNaN(t) ? NaN : Math.min(earliest, t)
      if (Number.isNaN(earliest)) break
    }
    if (!(earliest <= cutoffMs)) continue // also rejects NaN and no non-yanked file
    const c = best && compareVersions(version, best)
    if (!best || c > 0 || (c === 0 && version.length > best.length)) best = version
  }
  return best && { version: best, cutoff: new Date(cutoffMs).toISOString() }
}

const PYPI_URL = 'https://pypi.org/pypi/prism-validator/json'
const STATE = 'validator-update.json'
const NOT_INSTALLED = 'The newer version could not be downloaded or installed, so the current one stays.'
const NOT_COMPATIBLE = 'The new version did not pass the safety test, so the current one stays.'
const IN_USE = 'The update could not finish because the validator was in use. It will try again next start.'
const UNEXPECTED = 'The update did not work, so the current version stays. It will try again next start.'

const exists = (p) => stat(p).then(() => true, () => false)
const removeDir = (p) => rm(p, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})

// Runs the new validator exactly as the Save check does; any readable verdict (valid or invalid) proves the
// Save check understands its report. Unreadable, no verdict, or "BIDS check could not run" = reject.
export async function compatCheck({ runner, envDir, platform, tmpDir }) {
  try {
    const empty = await mkdtemp(join(tmpDir, 'empty-'))
    const run = await runner.run(envBin(envDir, 'prism-validator', platform), [empty, '--no-prism', '--bids', '--format', 'json'], { timeoutMs: 300000 })
    return interpretReport(run.stdout).verdict !== 'unknown'
  } catch {
    return false
  }
}

// Never throws: always resolves to a status. Builds <envDir>.next, proves it works, then swaps it in.
// `rename` is injectable so tests can simulate a Windows file lock (EBUSY/EPERM).
export async function updateValidator({ runner, uvPath, envDir, userDataDir, fetchJson, now, isBusy, platform = process.platform, rename = fsRename }) {
  const next = `${envDir}.next`
  const old = `${envDir}.old`
  const stateFile = join(userDataDir, STATE)
  let tmp
  try {
    // A crash between the two renames leaves only <envDir>.old: put it back before anything else.
    if (!(await exists(envDir)) && (await exists(old))) await rename(old, envDir)
    const status = await envStatus({ runner, envDir, platform })
    if (!status.ready) return { status: 'not-installed' }
    const from = parseVersion(status.validatorVersion)

    let pypi
    try { pypi = await fetchJson(PYPI_URL) } catch { return { status: 'offline' } }
    const pick = pickRelease(pypi, { now: now(), cooldownDays: PRISM_COOLDOWN_DAYS })
    if (!pick || !from || compareVersions(from, pick.version) >= 0) return { status: 'current' }
    const state = await readFile(stateFile, 'utf8').then(JSON.parse).catch(() => null)
    if (state?.failedVersion === pick.version) return { status: 'current' }
    const to = pick.version

    const failed = async (reason) => {
      await removeDir(next)
      await mkdir(userDataDir, { recursive: true })
      await writeFile(stateFile, JSON.stringify({ failedVersion: to }))
      return { status: 'failed', from, to, reason }
    }

    await removeDir(next)
    await removeDir(old)
    tmp = await mkdtemp(join(tmpdir(), 'prism-update-'))
    const input = join(tmp, 'in.txt')
    const lockPath = join(tmp, 'requirements.txt')
    await writeFile(input, `prism-validator==${to}\n`)
    // --exclude-newer with the same cutoff: dependencies obey the cooldown too. --generate-hashes so the
    // install below keeps --require-hashes.
    const compiled = await runner.run(uvPath, ['pip', 'compile', '--no-config', '--python-version', MANAGED_ENV.python,
      '--universal', '--generate-hashes', '--no-header', '--exclude-newer', pick.cutoff, '-o', lockPath, input], {})
    if (compiled.failed) return await failed(NOT_INSTALLED)
    const built = await ensureEnv({ runner, uvPath, envDir: next, lockPath, platform, source: 'auto-update' })
    if (!built.ready || parseVersion(built.validatorVersion) !== to) return await failed(NOT_INSTALLED)
    if (!(await compatCheck({ runner, envDir: next, platform, tmpDir: tmp }))) return await failed(NOT_COMPATIBLE)

    // Never swap under a running Save/validation: build again next start.
    if (isBusy()) {
      await removeDir(next)
      return { status: 'deferred', from, to }
    }
    try {
      await rename(envDir, old)
    } catch {
      await removeDir(next)
      return { status: 'failed', from, to, reason: IN_USE }
    }
    try {
      await rename(next, envDir)
    } catch {
      await rename(old, envDir).catch(() => {}) // if this fails too, the next start repairs it (see above)
      await removeDir(next)
      return { status: 'failed', from, to, reason: IN_USE }
    }
    await removeDir(old)
    await writeFile(stateFile, '{}').catch(() => {})
    return { status: 'updated', from, to }
  } catch {
    await removeDir(next)
    return { status: 'failed', reason: UNEXPECTED }
  } finally {
    if (tmp) await removeDir(tmp)
  }
}
