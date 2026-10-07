import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gateSave, inspectProject, interpretReport, isBidsProject, isConversionSave, isPrismProject } from '../src/datalad/prism-gate.js'

test('isPrismProject is true only when project.json is in the root', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prism '))
  assert.equal(await isPrismProject(dir), false)
  await writeFile(join(dir, 'project.json'), '{}')
  assert.equal(await isPrismProject(dir), true)
})

const gitRunner = (exitCode) => ({
  calls: [],
  async run(command, args) {
    this.calls.push([command, ...args])
    return { failed: exitCode !== 0, exitCode, stdout: '', stderr: '' }
  }
})

test('isConversionSave: exit 128 (not in HEAD / no HEAD) is a conversion, exit 0 is not, anything else throws', async () => {
  const gone = gitRunner(128)
  assert.equal(await isConversionSave({ runner: gone, projectPath: '/p q' }), true)
  assert.deepEqual(gone.calls[0], ['git', '-C', '/p q', 'cat-file', '-e', 'HEAD:project.json'])
  assert.equal(await isConversionSave({ runner: gitRunner(0), projectPath: '/p' }), false)
  await assert.rejects(isConversionSave({ runner: gitRunner(127), projectPath: '/p' }), /git/i)
})

// Real reports of prism-validator 1.20.0 (`--format json`), captured with test/fixtures/prism-validator/.
const fixture = (name) => readFile(new URL(`./fixtures/prism-validator/${name}.json`, import.meta.url), 'utf8')
const validReport = { valid: true, issues: [], summary: { total: 0, errors: 0, warnings: 0, info: 0 } }

test('interpretReport: valid report (warnings do not block)', async () => {
  assert.deepEqual(interpretReport(JSON.stringify(validReport)), { verdict: 'valid' })
  assert.deepEqual(interpretReport(await fixture('bids-valid')), { verdict: 'valid' })
})

test('interpretReport: a real invalid report lists its errors as one-line problems, warnings left out', async () => {
  const out = interpretReport(await fixture('prism-invalid'))
  assert.equal(out.verdict, 'invalid')
  assert.equal(out.errorCount, 4)
  assert.equal(out.errors.length, 4)
  assert.ok(out.errors.every((line) => !line.includes('README_FILE_SMALL')), 'a warning was listed as an error')
  assert.match(out.errors[0], /dataset_description\.json/)
  const bids = interpretReport(await fixture('bids-invalid'))
  assert.equal(bids.verdict, 'invalid')
  assert.equal(bids.errorCount, 1)
})

test('interpretReport: at most 10 problems are listed, the count stays complete', () => {
  const issues = Array.from({ length: 12 }, (_, i) => ({ code: 'X', severity: 'ERROR', message: `bad ${i}`, file_path: `/sub-${i}` }))
  const out = interpretReport(JSON.stringify({ valid: false, issues, summary: { errors: 12 } }))
  assert.equal(out.errorCount, 12)
  assert.equal(out.errors.length, 10)
  assert.equal(out.errors[0], '/sub-0: bad 0')
})

test('interpretReport: valid:true with errors counted is still invalid', () => {
  const out = interpretReport(JSON.stringify({ valid: true, issues: [], summary: { errors: 2 } }))
  assert.equal(out.verdict, 'invalid')
  assert.equal(out.errorCount, 2)
})

// 1.20.0 reports a BIDS check that could not run as an ERROR, but the data was never judged: that is "unchecked".
test('interpretReport: BIDS validator unavailable (PRISM902) is unknown, never invalid or valid', async () => {
  const out = interpretReport(await fixture('bids-unavailable'))
  assert.equal(out.verdict, 'unknown')
  assert.match(out.reason, /BIDS/)
})

test('interpretReport: bad JSON, preamble before JSON, or no verdict are unknown', () => {
  assert.equal(interpretReport('not json').verdict, 'unknown')
  assert.equal(interpretReport(`Scanning...\n${JSON.stringify(validReport)}`).verdict, 'unknown')
  assert.equal(interpretReport('{}').verdict, 'unknown')
  assert.equal(interpretReport('').verdict, 'unknown')
  assert.equal(interpretReport(JSON.stringify({ results: { valid: true } })).verdict, 'unknown')
})

// Fake runner: git cat-file → gitExit; validator → the given result.
function fakeRunner({ gitExit = 0, ignored = false, toplevel, validator } = {}) {
  const calls = []
  return {
    calls,
    async run(command, args, options) {
      calls.push([command, ...args])
      if (command !== 'git') return validator(args, options)
      if (args.includes('rev-parse')) {
        return gitExit === 127
          ? { failed: true, exitCode: 127, stdout: '', stderr: 'no git' }
          : { failed: false, exitCode: 0, stdout: `${toplevel ?? args[1]}\n`, stderr: '' }
      }
      if (args.includes('check-ignore')) return { failed: !ignored, exitCode: ignored ? 0 : 1, stdout: '', stderr: '' }
      return { failed: gitExit !== 0, exitCode: gitExit, stdout: '', stderr: '' }
    }
  }
}
const ok = (report) => ({ failed: false, exitCode: 0, stdout: JSON.stringify(report), stderr: '' })
const prismDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prism gate '))
  await writeFile(join(dir, 'project.json'), '{}')
  return dir
}
const gate = (runner, projectPath, extra = {}) =>
  gateSave({ runner, projectPath, validatorBin: '/env/bin/prism-validator', checkValidator: async () => true, ...extra })

test('non-PRISM projects pass straight through, ungated, without running the validator', async () => {
  const runner = fakeRunner()
  const dir = await mkdtemp(join(tmpdir(), 'plain '))
  assert.deepEqual(await gate(runner, dir), { allow: true, saveAll: false })
  assert.ok(runner.calls.every(([command]) => command === 'git'))
})

test('the conversion save is allowed without validating, but always saves everything so project.json is committed', async () => {
  const runner = fakeRunner({ gitExit: 128, validator: () => assert.fail('must not validate') })
  assert.deepEqual(await gate(runner, await prismDir()), { allow: true, saveAll: true })
})

test('a conversion save is blocked while project.json is git-ignored (it could never enter HEAD)', async () => {
  const runner = fakeRunner({ gitExit: 128, ignored: true, validator: () => assert.fail('must not validate') })
  const out = await gate(runner, await prismDir())
  assert.equal(out.allow, false)
  assert.equal(out.result.userError.code, 'PRISM_UNCHECKED')
  assert.match(out.result.userError.technicalDetails, /ignored/)
})

test('a git failure while checking the exemption blocks (fail closed)', async () => {
  const out = await gate(fakeRunner({ gitExit: 127 }), await prismDir())
  assert.equal(out.allow, false)
  assert.equal(out.result.userError.code, 'PRISM_UNCHECKED')
})

test('missing validator blocks with an install hint and never runs it', async () => {
  const runner = fakeRunner({ validator: () => assert.fail('must not run') })
  const out = await gate(runner, await prismDir(), { checkValidator: async () => false })
  assert.equal(out.result.userError.code, 'PRISM_VALIDATOR_MISSING')
  assert.match(out.result.userError.message, /Setup/)
})

test('valid report allows the save and marks it gated; path with spaces is one argv element', async () => {
  const dir = await prismDir()
  const runner = fakeRunner({ validator: () => ok(validReport) })
  assert.deepEqual(await gate(runner, dir), { allow: true, saveAll: true })
  assert.deepEqual(runner.calls.at(-1), ['/env/bin/prism-validator', dir, '--bids', '--format', 'json'])
})

test('invalid report blocks even when the validator exits non-zero, listing the problems', async () => {
  const report = { valid: false, summary: { errors: 2 }, issues: [{ severity: 'ERROR', file_path: 'a', message: 'x' }, { severity: 'ERROR', file_path: 'b', message: 'y' }] }
  const runner = fakeRunner({ validator: () => ({ ...ok(report), failed: true, exitCode: 1 }) })
  const out = await gate(runner, await prismDir())
  assert.equal(out.allow, false)
  const { userError } = out.result
  assert.equal(userError.code, 'PRISM_INVALID')
  assert.match(userError.message, /2 problems/)
  assert.deepEqual(userError.items, ['a: x', 'b: y'])
})

test('crash, timeout, garbage output and cancel all block as unchecked, with details', async () => {
  for (const validator of [
    () => ({ failed: true, exitCode: 2, stdout: '', stderr: 'Traceback boom' }),
    () => ({ failed: true, exitCode: 124, stdout: '', stderr: 'timed out after 300000ms' }),
    () => ({ failed: false, exitCode: 0, stdout: 'hello', stderr: '' }),
    () => ({ failed: true, cancelled: true, exitCode: 130, stdout: '', stderr: '' })
  ]) {
    const out = await gate(fakeRunner({ validator }), await prismDir())
    assert.equal(out.allow, false)
    assert.equal(out.result.userError.code, 'PRISM_UNCHECKED')
  }
  const crash = await gate(fakeRunner({ validator: () => ({ failed: true, exitCode: 2, stdout: '', stderr: 'Traceback boom' }) }), await prismDir())
  assert.match(crash.result.userError.technicalDetails, /Traceback boom/)
})

test('gateSave passes signal, onOutput and the timeout to the validator run', async () => {
  let seen
  const runner = fakeRunner({ validator: (_a, options) => { seen = options; return ok(validReport) } })
  const signal = new AbortController().signal
  const onOutput = () => {}
  await gate(runner, await prismDir(), { signal, onOutput })
  assert.deepEqual(seen, { signal, onOutput, timeoutMs: 300000 })
})

test('a save from a subfolder is gated on the repo root: its project.json decides and the validator checks the root', async () => {
  const root = await prismDir()
  const sub = join(root, 'sourcedata')
  await mkdir(sub)
  const runner = fakeRunner({ toplevel: root, validator: () => ok(validReport) })
  assert.deepEqual(await gate(runner, sub), { allow: true, saveAll: true })
  assert.deepEqual(runner.calls.at(-1), ['/env/bin/prism-validator', root, '--bids', '--format', 'json'])
})

test('a git that cannot find the repo root blocks the save (fail closed)', async () => {
  const out = await gate(fakeRunner({ gitExit: 127 }), await prismDir())
  assert.equal(out.allow, false)
  assert.equal(out.result.userError.code, 'PRISM_UNCHECKED')
})

test('a dangling project.json link (annexed, content not fetched) still marks a PRISM project', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prism annex '))
  await symlink('.git/annex/objects/missing', join(dir, 'project.json'))
  assert.equal(await isPrismProject(dir), true)
})

// ---- BIDS projects (dataset_description.json, no project.json) are gated too ----
const bidsDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bids gate '))
  await writeFile(join(dir, 'dataset_description.json'), '{}')
  return dir
}

test('isBidsProject is true when dataset_description.json is in the root (also as a dangling annex link)', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bids '))
  assert.equal(await isBidsProject(dir), false)
  await symlink('.git/annex/objects/missing', join(dir, 'dataset_description.json'))
  assert.equal(await isBidsProject(dir), true)
})

test('a BIDS-only project is validated with --no-prism --bids, and a valid report allows saving everything', async () => {
  const dir = await bidsDir()
  const runner = fakeRunner({ validator: () => ok(validReport) })
  assert.deepEqual(await gate(runner, dir), { allow: true, saveAll: true })
  assert.deepEqual(runner.calls.at(-1), ['/env/bin/prism-validator', dir, '--no-prism', '--bids', '--format', 'json'])
})

test('a BIDS-only project has no conversion exemption: it is validated even when HEAD has no marker file', async () => {
  const runner = fakeRunner({ gitExit: 128, validator: () => ok(validReport) })
  const out = await gate(runner, await bidsDir())
  assert.deepEqual(out, { allow: true, saveAll: true })
  assert.ok(runner.calls.some((call) => call[0] === '/env/bin/prism-validator'))
})

test('a project with both markers is a PRISM project: PRISM and BIDS are both checked', async () => {
  const dir = await prismDir()
  await writeFile(join(dir, 'dataset_description.json'), '{}')
  const runner = fakeRunner({ validator: () => ok(validReport) })
  await gate(runner, dir)
  assert.deepEqual(runner.calls.at(-1), ['/env/bin/prism-validator', dir, '--bids', '--format', 'json'])
})

test('an invalid BIDS project is blocked with a BIDS-specific message and its problems', async () => {
  const runner = fakeRunner({ validator: async () => ({ ...ok(JSON.parse(await fixture('bids-invalid'))), failed: true, exitCode: 1 }) })
  const out = await gate(runner, await bidsDir())
  assert.equal(out.allow, false)
  assert.equal(out.result.userError.code, 'PRISM_INVALID')
  assert.match(out.result.userError.title, /BIDS/)
  assert.match(out.result.userError.message, /BIDS check/)
  assert.equal(out.result.userError.items.length, 1)
})

test('a PRISM project failure still says PRISM', async () => {
  const runner = fakeRunner({ validator: async () => ({ ...ok(JSON.parse(await fixture('prism-invalid'))), failed: true, exitCode: 1 }) })
  const out = await gate(runner, await prismDir())
  assert.match(out.result.userError.title, /PRISM/)
})

test('a BIDS check that could not run (PRISM902) blocks as unchecked, not as invalid', async () => {
  const runner = fakeRunner({ validator: async () => ({ ...ok(JSON.parse(await fixture('bids-unavailable'))), failed: true, exitCode: 1 }) })
  const out = await gate(runner, await bidsDir())
  assert.equal(out.allow, false)
  assert.equal(out.result.userError.code, 'PRISM_UNCHECKED')
})

test('a missing validator blocks a BIDS project with the install hint too', async () => {
  const runner = fakeRunner({ validator: () => assert.fail('must not run') })
  const out = await gate(runner, await bidsDir(), { checkValidator: async () => false })
  assert.equal(out.result.userError.code, 'PRISM_VALIDATOR_MISSING')
})

// ---- what the UI is told about a project (display only; the gate itself decides in the main process) ----
test('inspectProject: PRISM, BIDS-only and plain projects', async () => {
  const runner = fakeRunner({ gitExit: 128 })
  const checkValidator = async () => true
  assert.deepEqual(
    await inspectProject({ runner, projectPath: await prismDir(), checkValidator }),
    { kind: 'prism', validatorReady: true, introducesPrism: true }
  )
  assert.deepEqual(
    await inspectProject({ runner, projectPath: await bidsDir(), checkValidator }),
    { kind: 'bids', validatorReady: true, introducesPrism: false }
  )
  const plain = await mkdtemp(join(tmpdir(), 'plain '))
  assert.deepEqual(
    await inspectProject({ runner, projectPath: plain, checkValidator }),
    { kind: null, validatorReady: false, introducesPrism: false }
  )
})

test('inspectProject reports a missing validator', async () => {
  const out = await inspectProject({ runner: fakeRunner(), projectPath: await bidsDir(), checkValidator: async () => false })
  assert.equal(out.validatorReady, false)
})

test('interpretReport: an error entry without a message or path still blocks and does not throw', () => {
  const out = interpretReport(JSON.stringify({ valid: false, issues: [{ severity: 'ERROR', code: 'X1' }], summary: { errors: 1 } }))
  assert.equal(out.verdict, 'invalid')
  assert.equal(out.errors.length, 1)
})
