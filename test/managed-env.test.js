import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MANAGED_ENV,
  createEnsureGuard,
  describeEnvFailure,
  ensureEnv,
  envBin,
  envStatus,
  resolveUv
} from '../src/datalad/managed-env.js'

test('resolveUv points into the bundled uv folder, .exe on Windows only', () => {
  assert.equal(resolveUv('/res', 'darwin'), join('/res', 'uv', 'uv'))
  assert.equal(resolveUv('/res', 'linux'), join('/res', 'uv', 'uv'))
  assert.equal(resolveUv('/res', 'win32'), join('/res', 'uv', 'uv.exe'))
})

test('envBin uses Scripts/*.exe on Windows and bin/ elsewhere', () => {
  assert.equal(envBin('/e', 'prism-validator', 'win32'), join('/e', 'Scripts', 'prism-validator.exe'))
  assert.equal(envBin('/e', 'prism-validator', 'darwin'), join('/e', 'bin', 'prism-validator'))
})

test('MANAGED_ENV pins python and exact-version packages', () => {
  assert.match(MANAGED_ENV.python, /^3\.\d+$/)
  assert.ok(MANAGED_ENV.packages.every((p) => /==/.test(p)))
})

function fakeRunner({ failStep, cancelStep } = {}) {
  const calls = []
  return {
    calls,
    async run(command, args) {
      calls.push([command, ...args])
      const step = args[0] === 'venv' ? 'venv' : args[0] === 'pip' ? 'install' : 'verify'
      if (step === cancelStep) return { failed: true, cancelled: true, exitCode: 130, stdout: '', stderr: '' }
      if (step === failStep) return { failed: true, exitCode: 1, stdout: '', stderr: `${step} boom` }
      if (step === 'venv') await mkdir(args.at(-1), { recursive: true })
      return { failed: false, exitCode: 0, stdout: step === 'verify' ? 'prism-validator 1.2.3\n' : '', stderr: '' }
    }
  }
}
const fresh = async () => join(await mkdtemp(join(tmpdir(), 'env ')), 'env')
const exists = (p) => access(p).then(() => true, () => false)

test('ensureEnv creates the venv, installs pinned packages, verifies, and writes a marker', async () => {
  const envDir = await fresh() // path contains a space on purpose
  const runner = fakeRunner()
  const config = { python: '3.12', packages: ['prism-validator==1.2.3'] }
  const result = await ensureEnv({ runner, uvPath: '/uv', envDir, config })
  assert.deepEqual(result, { ready: true, validatorVersion: 'prism-validator 1.2.3' })
  assert.deepEqual(runner.calls[0], ['/uv', 'venv', '--python', '3.12', envDir])
  assert.deepEqual(runner.calls[1].slice(0, 4), ['/uv', 'pip', 'install', '--python'])
  assert.ok(runner.calls[1].includes('prism-validator==1.2.3'))
})

test('ensureEnv is a no-op when marker and validator are current, and reinstalls when the pin changes', async () => {
  const envDir = await fresh()
  const config = { python: '3.12', packages: ['prism-validator==1.2.3'] }
  await ensureEnv({ runner: fakeRunner(), uvPath: '/uv', envDir, config })
  const again = fakeRunner()
  await ensureEnv({ runner: again, uvPath: '/uv', envDir, config })
  assert.equal(again.calls.filter((c) => c[1] === 'venv').length, 0)
  const bumped = fakeRunner()
  await ensureEnv({ runner: bumped, uvPath: '/uv', envDir, config: { ...config, packages: ['prism-validator==1.2.4'] } })
  assert.equal(bumped.calls.filter((c) => c[1] === 'venv').length, 1)
})

for (const failStep of ['venv', 'install', 'verify']) {
  test(`ensureEnv deletes the env when ${failStep} fails`, async () => {
    const envDir = await fresh()
    const result = await ensureEnv({ runner: fakeRunner({ failStep }), uvPath: '/uv', envDir, config: MANAGED_ENV })
    assert.equal(result.ready, false)
    assert.equal(result.failure.step, failStep)
    assert.equal(await exists(envDir), false)
  })
}

test('ensureEnv reports cancelled and removes the partial env', async () => {
  const envDir = await fresh()
  const result = await ensureEnv({ runner: fakeRunner({ cancelStep: 'install' }), uvPath: '/uv', envDir, config: MANAGED_ENV })
  assert.equal(result.cancelled, true)
  assert.equal(await exists(envDir), false)
})

test('ensureEnv wipes a half-built env left by an interrupted earlier run', async () => {
  const envDir = await fresh()
  await mkdir(envDir, { recursive: true }) // exists, but no marker
  const runner = fakeRunner()
  await ensureEnv({ runner, uvPath: '/uv', envDir, config: MANAGED_ENV })
  assert.equal(runner.calls.filter((c) => c[1] === 'venv').length, 1)
})

test('envStatus is not ready when the validator cannot run', async () => {
  const status = await envStatus({ runner: fakeRunner({ failStep: 'verify' }), envDir: '/nope' })
  assert.deepEqual(status, { ready: false, validatorVersion: null })
})

const d = (stderr, extra = {}) => describeEnvFailure({ failure: { stderr, exitCode: 1, step: 'install', ...extra }, uvPath: '/app/uv/uv' })

test('describeEnvFailure maps known stderr to plain-language codes', () => {
  assert.equal(d('error: No solution found ... Because prism-validator was not found in the package registry').code, 'PACKAGE_NOT_FOUND')
  assert.equal(d('Because there is no version of prism-validator==0.0.0 and you require prism-validator==0.0.0, we can conclude that your requirements are unsatisfiable.').code, 'PACKAGE_NOT_FOUND')
  assert.equal(d('error: Failed to fetch: dns error: failed to lookup address').code, 'OFFLINE')
  assert.equal(d('error: No space left on device (os error 28)').code, 'DISK')
  assert.equal(d('error: Permission denied (os error 13)').code, 'DISK')
  assert.equal(d('something odd').code, 'UNKNOWN')
})

test('a spawn failure (127) names the bundled uv path; cancel is its own code', () => {
  const blocked = d('spawn EACCES', { exitCode: 127 })
  assert.equal(blocked.code, 'UV_BLOCKED')
  assert.match(blocked.message, /\/app\/uv\/uv/)
  assert.equal(describeEnvFailure({ cancelled: true, failure: {}, uvPath: 'x' }).code, 'CANCELLED')
})

test('createEnsureGuard refuses a second concurrent run but allows one after it finishes', async () => {
  const guard = createEnsureGuard()
  let release
  const first = guard.run(() => new Promise((r) => { release = r }))
  await assert.rejects(guard.run(async () => {}), /already running/)
  release('ok')
  assert.equal(await first, 'ok')
  assert.equal(await guard.run(async () => 'again'), 'again')
})
