import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gateSave, interpretReport, isConversionSave, isPrismProject } from '../src/datalad/prism-gate.js'

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

// Real shape of a valid PRISM report (abridged).
const validReport = { summary: { total_errors: 0 }, results: { valid: true, errors: [] } }

test('interpretReport: valid report', () => {
  assert.deepEqual(interpretReport(JSON.stringify(validReport)), { verdict: 'valid' })
})

test('interpretReport: invalid report lists at most 10 one-line errors', () => {
  const errors = Array.from({ length: 12 }, (_, i) => ({ path: `sub-${i}`, message: 'bad' }))
  const out = interpretReport(JSON.stringify({ summary: { total_errors: 12 }, results: { valid: false, errors } }))
  assert.equal(out.verdict, 'invalid')
  assert.equal(out.errorCount, 12)
  assert.equal(out.errors.length, 10)
  assert.equal(out.errors[0], 'sub-0: bad')
})

test('interpretReport: odd error entries still become one line', () => {
  const out = interpretReport(JSON.stringify({ results: { valid: false, errors: ['plain', { code: 'X1' }, { message: 'only msg' }] } }))
  assert.deepEqual(out.errors, ['plain', '{"code":"X1"}', 'only msg'])
})

test('interpretReport: valid:true with errors counted is still invalid', () => {
  const out = interpretReport(JSON.stringify({ summary: { total_errors: 2 }, results: { valid: true, errors: [] } }))
  assert.equal(out.verdict, 'invalid')
  assert.equal(out.errorCount, 2)
})

test('interpretReport: bad JSON, preamble before JSON, or no verdict are unknown', () => {
  assert.equal(interpretReport('not json').verdict, 'unknown')
  assert.equal(interpretReport(`Scanning...\n${JSON.stringify(validReport)}`).verdict, 'unknown')
  assert.equal(interpretReport('{}').verdict, 'unknown')
  assert.equal(interpretReport('').verdict, 'unknown')
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
  const runner = fakeRunner({ validator: () => ok({ summary: { total_errors: 0 }, results: { valid: true } }) })
  assert.deepEqual(await gate(runner, dir), { allow: true, saveAll: true })
  assert.deepEqual(runner.calls.at(-1), ['/env/bin/prism-validator', dir, '--format', 'json'])
})

test('invalid report blocks even when the validator exits non-zero, listing the problems', async () => {
  const report = { summary: { total_errors: 2 }, results: { valid: false, errors: [{ path: 'a', message: 'x' }, { path: 'b', message: 'y' }] } }
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
  const runner = fakeRunner({ validator: (_a, options) => { seen = options; return ok({ summary: { total_errors: 0 }, results: { valid: true } }) } })
  const signal = new AbortController().signal
  const onOutput = () => {}
  await gate(runner, await prismDir(), { signal, onOutput })
  assert.deepEqual(seen, { signal, onOutput, timeoutMs: 300000 })
})

test('a save from a subfolder is gated on the repo root: its project.json decides and the validator checks the root', async () => {
  const root = await prismDir()
  const sub = join(root, 'sourcedata')
  await mkdir(sub)
  const runner = fakeRunner({ toplevel: root, validator: () => ok({ summary: { total_errors: 0 }, results: { valid: true } }) })
  assert.deepEqual(await gate(runner, sub), { allow: true, saveAll: true })
  assert.deepEqual(runner.calls.at(-1), ['/env/bin/prism-validator', root, '--format', 'json'])
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
