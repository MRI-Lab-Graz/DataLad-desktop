import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureEnv, envStatus, resolveUv } from '../src/datalad/managed-env.js'
import { ProcessRunner } from '../src/datalad/process-runner.js'

// Opt-in (DLAD_REAL_UV=1): real bundled uv, real network. Proves the auto-update swap works for real:
// an env built at <dir>.next and renamed to <dir> must still start (entry points must not hard-code the build path).
const uvPath = resolveUv(fileURLToPath(new URL('../build', import.meta.url)))
const lockPath = fileURLToPath(new URL('../build/prism-requirements.txt', import.meta.url))
const skip = process.env.DLAD_REAL_UV !== '1' ? 'set DLAD_REAL_UV=1 to run' : !existsSync(uvPath) && 'bundled uv missing (build/uv)'

test('real uv: an env built at env.next still works after the rename to env', { skip, timeout: 20 * 60 * 1000 }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'real uv '))
  try {
    const runner = new ProcessRunner()
    const next = join(base, 'env.next')
    const built = await ensureEnv({ runner, uvPath, envDir: next, lockPath, source: 'auto-update' })
    assert.equal(built.ready, true, JSON.stringify(built.failure))
    const envDir = join(base, 'env')
    await rename(next, envDir)
    const status = await envStatus({ runner, envDir })
    console.log('after swap:', status)
    assert.equal(status.ready, true)
    assert.match(status.validatorVersion, /\b1\.20\.0\b/)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
