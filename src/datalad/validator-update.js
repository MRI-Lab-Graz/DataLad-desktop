import { mkdir, mkdtemp, readFile, rename as fsRename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MANAGED_ENV, UV_ENV, describeEnvFailure, ensureEnv, envBin, envStatus } from './managed-env.js'
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
const COMPILE_TIMEOUT_MS = 120000
export const BUILD_TIMEOUT_MS = 20 * 60 * 1000
const LATER = 'It will try again when an even newer version comes out.'
const DOWNLOAD_FAILED = `The newer version could not be installed, so the current one stays. ${LATER}`
const NOT_COMPATIBLE = `The new version did not pass the safety test, so the current one stays. ${LATER}`
const NEXT_START = 'It will try again next start.'
const IN_USE = `The update could not finish because the validator was in use. ${NEXT_START}`
const DISK = `There isn't enough disk space, or the app isn't allowed to write to its data folder. ${NEXT_START}`
const BLOCKED = `The update helper could not start. Security software may have blocked it. ${NEXT_START}`
const UNEXPECTED = `The update did not work, so the current version stays. ${NEXT_START}`

const exists = (p) => stat(p).then(() => true, () => false)
const removeDir = (p) => rm(p, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})

// Call on every start (also when updates are off). A crash between the two swap renames leaves only
// <envDir>.old: put it back. Otherwise a leftover .old is just old files. Never throws.
export async function repairEnvDir({ envDir, rename = fsRename, remove = removeDir }) {
  const old = `${envDir}.old`
  try {
    if (await exists(envDir)) await remove(old)
    else if (await exists(old)) await rename(old, envDir)
  } catch {}
}

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

// Failures that are not the version's fault: do not remember the version, try again next start.
function notTheVersionsFault(failure, uvPath) {
  if (failure.exitCode === 124) return { status: 'offline' } // compile timeout
  const { code } = describeEnvFailure({ failure, cancelled: failure.cancelled, uvPath })
  if (code === 'OFFLINE') return { status: 'offline' }
  if (code === 'CANCELLED') return { status: 'current' }
  if (code === 'DISK') return { status: 'failed', reason: DISK }
  if (code === 'UV_BLOCKED') return { status: 'failed', reason: BLOCKED }
  return null
}

// Never throws: always resolves to a status. Builds <envDir>.next, proves it works, then swaps it in.
// `rename` is injectable so tests can simulate a Windows file lock (EBUSY/EPERM).
export async function updateValidator({ runner, uvPath, envDir, userDataDir, fetchJson, now, isBusy, platform = process.platform, rename = fsRename }) {
  const next = `${envDir}.next`
  const old = `${envDir}.old`
  const stateFile = join(userDataDir, STATE)
  let tmp
  try {
    await repairEnvDir({ envDir, rename })
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

    const failed = async (reason, failure) => {
      await removeDir(next)
      const transient = failure && notTheVersionsFault(failure, uvPath)
      if (transient) return transient.status === 'failed' ? { ...transient, from, to } : transient
      await mkdir(userDataDir, { recursive: true })
      await writeFile(stateFile, JSON.stringify({ failedVersion: to }))
      return { status: 'failed', from, to, reason }
    }

    await removeDir(next)
    tmp = await mkdtemp(join(tmpdir(), 'prism-update-'))
    const input = join(tmp, 'in.txt')
    const lockPath = join(tmp, 'requirements.txt')
    await writeFile(input, `prism-validator==${to}\n`)
    // Same rules as the install: --exclude-newer with the same cutoff (dependencies obey the cooldown too),
    // hashes for --require-hashes, wheels only (no package build code runs, not even to read metadata),
    // the one fixed index, no uv.toml or UV_* index variables.
    const compiled = await runner.run(uvPath, ['pip', 'compile', '--no-config', '--python-version', MANAGED_ENV.python,
      '--universal', '--generate-hashes', '--no-header', '--only-binary', ':all:', '--index-url', 'https://pypi.org/simple',
      '--exclude-newer', pick.cutoff, '-o', lockPath, input], { timeoutMs: COMPILE_TIMEOUT_MS, env: UV_ENV })
    if (compiled.failed) return await failed(DOWNLOAD_FAILED, compiled)
    const built = await ensureEnv({ runner, uvPath, envDir: next, lockPath, platform, source: 'auto-update', timeoutMs: BUILD_TIMEOUT_MS })
    if (!built.ready) return await failed(DOWNLOAD_FAILED, built.failure && { ...built.failure, cancelled: built.cancelled })
    const got = parseVersion(built.validatorVersion)
    if (!got || compareVersions(got, to) !== 0) return await failed(DOWNLOAD_FAILED)
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
      const back = await rename(old, envDir).then(() => true, () => false)
      // A verified new env beats no env. If both fail, repairEnvDir restores .old next start.
      const swapped = !back && (await rename(next, envDir).then(() => true, () => false))
      if (!swapped) {
        await removeDir(next)
        return { status: 'failed', from, to, reason: IN_USE }
      }
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
