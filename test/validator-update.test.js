import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PRISM_COOLDOWN_DAYS,
  compareVersions,
  parseVersion,
  compatCheck,
  pickRelease,
  repairEnvDir,
  updateValidator
} from '../src/datalad/validator-update.js'
import { access, mkdir, mkdtemp, readdir, readFile, rename as fsRename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const file = (time, yanked = false) => ({
  filename: 'x.whl',
  yanked,
  upload_time_iso_8601: time
})

const NOW = new Date('2026-11-04T12:00:00Z')
const fixture = {
  info: { name: 'prism-validator' },
  releases: {
    '1.19.1': [file('2026-09-01T10:00:00.123456Z')],
    '1.20.0': [file('2026-10-07T10:00:00.123456Z')],
    '1.21.0': [file('2026-10-20T10:00:00.000000Z'), file('2026-10-21T10:00:00.000000Z')],
    '1.21.1': [file('2026-11-03T10:00:00.000000Z')],
    '1.22.0rc1': [file('2026-10-01T10:00:00.000000Z')],
    '1.23.0': [file('2026-10-01T10:00:00.000000Z', true)],
    '1.24.0': []
  }
}

test('cooldown default is 3 days', () => {
  assert.equal(PRISM_COOLDOWN_DAYS, 3)
})

test('parseVersion finds the first dotted number', () => {
  assert.equal(parseVersion('prism-validator 1.19.1'), '1.19.1')
  assert.equal(parseVersion(null), null)
  assert.equal(parseVersion('no version here'), null)
})

test('compareVersions compares numerically, missing parts are 0', () => {
  assert.ok(compareVersions('1.9.0', '1.20.0') < 0)
  assert.equal(compareVersions('1.20', '1.20.0'), 0)
  assert.ok(compareVersions('2.0', '1.20.0') > 0)
})

test('pickRelease skips pre-releases, too-new, yanked and empty releases', () => {
  const r = pickRelease(fixture, { now: NOW, cooldownDays: 3 })
  assert.equal(r.version, '1.21.0')
  assert.equal(r.cutoff, '2026-11-01T12:00:00.000Z')
})

test('pickRelease returns null for malformed input', () => {
  for (const bad of [{}, null, 'x', { releases: {} }, { releases: { '1.0': 'oops' } }]) {
    assert.equal(pickRelease(bad, { now: NOW, cooldownDays: 3 }), null)
  }
})

const pick = (releases) => pickRelease({ releases }, { now: NOW, cooldownDays: 3 })

test('pickRelease never throws on a huge file list', () => {
  const files = Array.from({ length: 200_000 }, () => file('2026-10-01T10:00:00Z'))
  assert.equal(pick({ '1.0.0': files })?.version, '1.0.0')
})

test('cooldown ignores yanked files', () => {
  const old = '2026-10-01T10:00:00Z'
  const young = '2026-11-03T12:00:00Z'
  assert.equal(pick({ '1.0.0': [file(old, true), file(young)] }), null)
  assert.equal(pick({ '1.0.0': [file(old, true), file(old), file(young, true)] })?.version, '1.0.0')
})

test('pickRelease rejects non-object releases', () => {
  assert.equal(pick([['1.0.0']]), null)
  assert.equal(pick('1.0.0'), null)
})

test('huge version parts are skipped, parseVersion caps its scan', () => {
  const huge = '1.' + '9'.repeat(30)
  assert.equal(pick({ [huge]: [file('2026-10-01T10:00:00Z')] }), null)
  assert.equal(parseVersion('v' + huge), null)
  assert.equal(parseVersion(' '.repeat(500) + '1.2.3'), null)
})

test('cooldown boundary is inclusive to the millisecond', () => {
  const exact = new Date(NOW.getTime() - 3 * 86400000)
  assert.equal(pick({ '1.0.0': [file(exact.toISOString())] })?.version, '1.0.0')
  assert.equal(pick({ '1.0.0': [file(new Date(exact.getTime() + 1).toISOString())] }), null)
})

test('a __proto__ key in releases is ignored', () => {
  const json = JSON.parse('{"releases":{"__proto__":[{"upload_time_iso_8601":"2026-10-01T10:00:00Z"}]}}')
  assert.equal(pickRelease(json, { now: NOW, cooldownDays: 3 }), null)
})

test('1.20 and 1.20.0 give the same pick in any order', () => {
  const f = [file('2026-10-01T10:00:00Z')]
  assert.equal(pick({ '1.20': f, '1.20.0': f }).version, pick({ '1.20.0': f, '1.20': f }).version)
})

// --- updateValidator / compatCheck: fake runner, real temp dirs ---
const ok = (stdout = '') => ({ failed: false, exitCode: 0, stdout, stderr: '' })
const bad = { failed: true, exitCode: 1, stdout: '', stderr: 'boom' }

// Each env dir holds a VERSION file that `--version` prints; `pip install` writes it into the target env.
// `compile` / `install`: a scripted failure result instead of success. `options` records each call's options.
function updateRunner({ compile, install, compat = '{"valid":false,"issues":[]}', newVersion = '1.21.0', installs = newVersion } = {}) {
  const calls = []
  const options = []
  return {
    calls,
    options,
    async run(command, args, opts) {
      calls.push([command, ...args])
      options.push(opts)
      if (command === '/uv') {
        if (args[0] === 'venv') { await mkdir(args.at(-1), { recursive: true }); return ok() }
        if (args[1] === 'compile') {
          if (compile) return compile
          await writeFile(args[args.indexOf('-o') + 1], `prism-validator==${newVersion} \\\n    --hash=sha256:aa\n`)
          return ok()
        }
        if (install) return install
        await writeFile(join(args[args.indexOf('--python') + 1], 'VERSION'), `prism-validator ${installs}\n`)
        return ok()
      }
      if (args[0] === '--version') {
        const v = await readFile(join(dirname(dirname(command)), 'VERSION'), 'utf8').catch(() => null)
        return v ? ok(v) : bad
      }
      return ok(compat)
    }
  }
}

const PYPI = { releases: { '1.20.0': [file('2026-10-07T10:00:00Z')], '1.21.0': [file('2026-10-20T10:00:00Z')] } }
const CUTOFF = new Date(NOW.getTime() - PRISM_COOLDOWN_DAYS * 86400000).toISOString()

async function setup({ installed = '1.20.0', runner = updateRunner(), ...overrides } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'upd '))
  const envDir = join(base, 'env')
  if (installed) {
    await mkdir(envDir)
    await writeFile(join(envDir, 'VERSION'), `prism-validator ${installed}\n`)
  }
  const userDataDir = join(base, 'data') // not created: updateValidator must create it
  const deps = { runner, uvPath: '/uv', envDir, userDataDir, fetchJson: async () => PYPI, now: () => NOW, isBusy: () => false, platform: 'linux', ...overrides }
  return { deps, runner, envDir, userDataDir, stateFile: join(userDataDir, 'validator-update.json') }
}
const exists = (p) => access(p).then(() => true, () => false)
const versionIn = (dir) => readFile(join(dir, 'VERSION'), 'utf8').then((t) => t.trim())
const compileCall = (runner) => runner.calls.find((c) => c[2] === 'compile')

test('(a) not installed: nothing is fetched', async () => {
  let fetched = false
  const { deps } = await setup({ installed: null, fetchJson: async () => { fetched = true; return PYPI } })
  assert.deepEqual(await updateValidator(deps), { status: 'not-installed' })
  assert.equal(fetched, false)
})

test('(b) up to date: no build', async () => {
  const { deps, runner } = await setup({ installed: '1.21.0' })
  assert.equal((await updateValidator(deps)).status, 'current')
  assert.equal(compileCall(runner), undefined)
})

test('(c) happy path swaps in the new env and clears leftovers and the failure record', async () => {
  const { deps, envDir, stateFile } = await setup()
  await mkdir(join(`${envDir}.old`, 'junk'), { recursive: true }) // from a crashed earlier run
  await mkdir(join(`${envDir}.next`, 'junk'), { recursive: true })
  await mkdir(dirname(stateFile), { recursive: true })
  await writeFile(stateFile, JSON.stringify({ failedVersion: '1.19.0' }))
  assert.deepEqual(await updateValidator(deps), { status: 'updated', from: '1.20.0', to: '1.21.0' })
  assert.equal(await versionIn(envDir), 'prism-validator 1.21.0')
  assert.equal(await exists(`${envDir}.next`), false)
  assert.equal(await exists(`${envDir}.old`), false)
  const marker = JSON.parse(await readFile(join(envDir, 'managed-env.json'), 'utf8'))
  assert.equal(marker.source, 'auto-update')
  assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).failedVersion, undefined)
})

test('(d) compile is hash-locked, uses the cutoff, and its temp files are removed; a corrupt record is ignored', async () => {
  const { deps, runner, stateFile } = await setup()
  await mkdir(dirname(stateFile), { recursive: true })
  await writeFile(stateFile, '{bad')
  assert.equal((await updateValidator(deps)).status, 'updated')
  const call = compileCall(runner)
  for (const flag of ['--no-config', '--universal', '--generate-hashes', '--no-header']) assert.ok(call.includes(flag), flag)
  assert.equal(call[call.indexOf('--python-version') + 1], '3.12')
  assert.equal(call[call.indexOf('--exclude-newer') + 1], CUTOFF)
  assert.equal(call[call.indexOf('--only-binary') + 1], ':all:') // never build an sdist just to read its metadata
  assert.equal(call[call.indexOf('--index-url') + 1], 'https://pypi.org/simple')
  const compileOpts = runner.options[runner.calls.indexOf(call)]
  assert.equal(compileOpts.timeoutMs, 120000)
  for (const key of ['UV_INDEX_URL', 'UV_DEFAULT_INDEX', 'UV_INDEX', 'UV_EXTRA_INDEX_URL', 'UV_FIND_LINKS']) {
    assert.ok(key in compileOpts.env && compileOpts.env[key] === undefined, key) // undefined = not passed to the child
  }
  const lock = call[call.indexOf('-o') + 1]
  assert.equal(await exists(dirname(lock)), false)
  const install = runner.calls.find((c) => c[2] === 'install')
  assert.equal(install[install.indexOf('-r') + 1], lock)
  assert.ok(install.includes('--require-hashes') && install.includes('--no-deps'))
})

test('(e) busy: deferred, original env unchanged', async () => {
  const { deps, envDir } = await setup({ isBusy: () => true })
  assert.equal((await updateValidator(deps)).status, 'deferred')
  assert.equal(await versionIn(envDir), 'prism-validator 1.20.0')
  assert.equal(await exists(`${envDir}.next`), false)
})

test('(f) failed compat check: old env stays, version remembered and not retried', async () => {
  const { deps, runner, envDir, stateFile } = await setup({ runner: updateRunner({ compat: 'not json' }) })
  const result = await updateValidator(deps)
  assert.equal(result.status, 'failed')
  assert.doesNotMatch(result.reason, /hash|wheel|uv/i)
  assert.equal(await versionIn(envDir), 'prism-validator 1.20.0')
  assert.equal(await exists(`${envDir}.next`), false)
  assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).failedVersion, '1.21.0')
  const before = runner.calls.length
  assert.equal((await updateValidator(deps)).status, 'current')
  assert.equal(runner.calls.filter((c) => c[0] === '/uv').length, runner.calls.slice(0, before).filter((c) => c[0] === '/uv').length)
})

test('(f2) failed download: old env stays, version remembered', async () => {
  const { deps, runner, envDir, stateFile } = await setup({ runner: updateRunner({ compile: bad }) })
  assert.equal((await updateValidator(deps)).status, 'failed')
  const call = compileCall(runner)
  assert.equal(await exists(dirname(call[call.indexOf('-o') + 1])), false)
  assert.equal(await versionIn(envDir), 'prism-validator 1.20.0')
  assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).failedVersion, '1.21.0')
})

test('(g) second rename fails (Windows file in use): old env restored, retried next start', async () => {
  const rename = async (from, to) => {
    if (from.endsWith('.next')) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
    return fsRename(from, to)
  }
  const { deps, envDir, stateFile } = await setup({ rename })
  const result = await updateValidator(deps)
  assert.equal(result.status, 'failed')
  assert.match(result.reason, /next start/)
  assert.equal(await versionIn(envDir), 'prism-validator 1.20.0')
  assert.equal(await exists(`${envDir}.old`), false)
  assert.equal(await exists(`${envDir}.next`), false)
  assert.equal(await exists(stateFile), false) // a busy file is not the version's fault
})

test('(h) PyPI unreachable: offline, no runner calls beyond the installed check', async () => {
  const { deps, runner } = await setup({ fetchJson: async () => { throw new Error('ENOTFOUND') } })
  assert.equal((await updateValidator(deps)).status, 'offline')
  assert.ok(runner.calls.every((c) => c[0] !== '/uv'))
})

test('(h2) garbage from PyPI: current, nothing built', async () => {
  const { deps, runner } = await setup({ fetchJson: async () => 'garbage' })
  assert.equal((await updateValidator(deps)).status, 'current')
  assert.ok(runner.calls.every((c) => c[0] !== '/uv'))
})

test('(i) compatCheck accepts any readable verdict and rejects the rest', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'compat '))
  const check = (stdout) => compatCheck({ runner: { run: async () => ok(stdout) }, envDir: '/e', platform: 'linux', tmpDir })
  assert.equal(await check('not json'), false)
  assert.equal(await check('{"valid":false,"issues":[{"code":"PRISM902"}]}'), false)
  assert.equal(await check('{"issues":[]}'), false)
  assert.equal(await check('{"valid":false,"issues":[]}'), true)
})

test('(i2) compatCheck runs the Save-check arguments on an empty folder', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'compat '))
  const runner = updateRunner()
  await compatCheck({ runner, envDir: '/e', platform: 'win32', tmpDir })
  const [command, dir, ...rest] = runner.calls[0]
  assert.equal(command, join('/e', 'Scripts', 'prism-validator.exe'))
  assert.deepEqual(rest, ['--no-prism', '--bids', '--format', 'json'])
  assert.deepEqual(await readdir(dir), [])
})

test('(j) a crash between the renames is repaired: the old env comes back', async () => {
  const { deps, envDir } = await setup({ installed: null })
  await mkdir(`${envDir}.old`)
  await writeFile(join(`${envDir}.old`, 'VERSION'), 'prism-validator 1.21.0\n')
  assert.equal((await updateValidator(deps)).status, 'current')
  assert.equal(await versionIn(envDir), 'prism-validator 1.21.0')
})

test('(k) an env that reports a different version than chosen is rejected', async () => {
  const { deps, envDir } = await setup({ runner: updateRunner({ installs: '1.20.5' }) })
  assert.equal((await updateValidator(deps)).status, 'failed')
  assert.equal(await versionIn(envDir), 'prism-validator 1.20.0')
})

// --- fix round 1 ---
const fail = (stderr, exitCode = 1, extra = {}) => ({ failed: true, exitCode, stdout: '', stderr, ...extra })
const compiles = (runner) => runner.calls.filter((c) => c[2] === 'compile').length

test('(l) offline while downloading: offline, nothing recorded, retried next call', async () => {
  for (const runner of [updateRunner({ compile: fail('dns error: failed to lookup') }), updateRunner({ install: fail('connection reset by peer') }),
    updateRunner({ compile: fail('uv timed out after 120000ms', 124) })]) {
    const { deps, envDir, stateFile } = await setup({ runner })
    assert.deepEqual(await updateValidator(deps), { status: 'offline' })
    assert.equal(await exists(stateFile), false)
    assert.equal(await exists(`${envDir}.next`), false)
    assert.equal(await versionIn(envDir), 'prism-validator 1.20.0')
    await updateValidator(deps)
    assert.equal(compiles(runner), 2)
  }
})

test('(l2) disk full or blocked helper: failed with a plain reason, nothing recorded', async () => {
  for (const runner of [updateRunner({ install: fail('No space left on device (os error 28)') }), updateRunner({ compile: fail('', 127) })]) {
    const { deps, stateFile } = await setup({ runner })
    const result = await updateValidator(deps)
    assert.equal(result.status, 'failed')
    assert.match(result.reason, /next start/)
    assert.doesNotMatch(result.reason, /hash|wheel|\buv\b/i)
    assert.equal(await exists(stateFile), false)
  }
})

test('(l3) cancelled: current, nothing recorded', async () => {
  const { deps, stateFile } = await setup({ runner: updateRunner({ compile: fail('', 130, { cancelled: true }) }) })
  assert.deepEqual(await updateValidator(deps), { status: 'current' })
  assert.equal(await exists(stateFile), false)
})

test('(m1) restore fails too: the verified new env is put in place as a last resort', async () => {
  let nextTries = 0
  const rename = async (from, to) => {
    if (from.endsWith('.next') && nextTries++ === 0) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
    if (from.endsWith('.old')) throw Object.assign(new Error('perm'), { code: 'EPERM' })
    return fsRename(from, to)
  }
  const { deps, envDir } = await setup({ rename })
  assert.equal((await updateValidator(deps)).status, 'updated')
  assert.equal(await versionIn(envDir), 'prism-validator 1.21.0')
  assert.equal(await exists(`${envDir}.next`), false)
})

test('(m2) repairEnvDir restores a lone .old and removes a leftover .old', async () => {
  const base = await mkdtemp(join(tmpdir(), 'repair '))
  const envDir = join(base, 'env')
  await mkdir(`${envDir}.old`)
  await writeFile(join(`${envDir}.old`, 'VERSION'), 'a')
  await repairEnvDir({ envDir })
  assert.equal(await readFile(join(envDir, 'VERSION'), 'utf8'), 'a')
  assert.equal(await exists(`${envDir}.old`), false)
  await mkdir(`${envDir}.old`)
  await repairEnvDir({ envDir })
  assert.equal(await exists(`${envDir}.old`), false)
  assert.equal(await readFile(join(envDir, 'VERSION'), 'utf8'), 'a')
  await repairEnvDir({ envDir: join(base, 'nothing') }) // nothing there: no throw
})

test('(m6) first rename fails: failed, env unchanged, .next removed, nothing recorded', async () => {
  const rename = async (from, to) => {
    if (!from.endsWith('.next') && !from.endsWith('.old')) throw Object.assign(new Error('perm'), { code: 'EPERM' })
    return fsRename(from, to)
  }
  const { deps, envDir, stateFile } = await setup({ rename })
  const result = await updateValidator(deps)
  assert.equal(result.status, 'failed')
  assert.match(result.reason, /next start/)
  assert.equal(await versionIn(envDir), 'prism-validator 1.20.0')
  assert.equal(await exists(`${envDir}.next`), false)
  assert.equal(await exists(stateFile), false)
})

test('(m6b) isBusy throwing: failed, never a throw, env unchanged', async () => {
  const { deps, envDir } = await setup({ isBusy: () => { throw new Error('x') } })
  assert.equal((await updateValidator(deps)).status, 'failed')
  assert.equal(await versionIn(envDir), 'prism-validator 1.20.0')
  assert.equal(await exists(`${envDir}.next`), false)
})
