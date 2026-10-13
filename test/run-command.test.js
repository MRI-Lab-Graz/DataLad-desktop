import test from 'node:test'
import assert from 'node:assert/strict'
import { DataLadAdapter, CURATED_COMMANDS } from '../src/datalad/adapter.js'
import { assertCommandRequest } from '../src/datalad/schema.js'
import { mapCommandError } from '../src/datalad/errors.js'

class Runner {
  constructor(result = {}) {
    this.calls = []
    this.result = { exitCode: 0, stdout: '', stderr: '', failed: false, ...result }
  }
  async run(command, args = [], options = {}) {
    this.calls.push({ command, args, options })
    return { command, args, ...this.result }
  }
}

const ok = { projectPath: '/tmp/p', message: 'Summary', command: 'python summarize.py' }

test('run is a curated command', () => {
  assert.ok(CURATED_COMMANDS.has('run'))
})

test('run builds datalad run with every value bound to its flag and the command as a plain last argument', async () => {
  const runner = new Runner()
  await new DataLadAdapter({ runner }).runCommand('run', {
    ...ok,
    inputs: ['data/a.csv', 'raw/*.tsv', 'my file.csv'],
    outputs: ['summary.txt']
  })
  assert.deepEqual(runner.calls[0].args, [
    '-C', '/tmp/p', 'run', '--message=Summary',
    '--input=data/a.csv', '--input=raw/*.tsv', '--input=my file.csv',
    '--output=summary.txt',
    'python summarize.py'
  ])
  assert.equal(runner.calls[0].command, 'datalad')
  assert.deepEqual(runner.calls[0].options.cwd, '/tmp/p')
})

test('run without inputs or outputs passes none', async () => {
  const runner = new Runner()
  await new DataLadAdapter({ runner }).runCommand('run', ok)
  assert.deepEqual(runner.calls[0].args, ['-C', '/tmp/p', 'run', '--message=Summary', 'python summarize.py'])
})

// Measured with real DataLad: after "--" a single string is taken as ONE PROGRAM NAME ("/bin/sh: node s.js: command
// not found"); without "--" it is a shell command line (pipes, redirects, several words). So the command goes as a
// plain last argument, and one that starts with "-" (which DataLad would parse as an option) is refused.
test('the command is one plain last argument (a shell line), never after --', async () => {
  const runner = new Runner()
  await new DataLadAdapter({ runner }).runCommand('run', { ...ok, command: 'echo "q" | wc -l > out.txt' })
  assert.equal(runner.calls[0].args.at(-1), 'echo "q" | wc -l > out.txt')
  assert.equal(runner.calls[0].args.includes('--'), false)
})

// Measured with real DataLad: plain braces in the command are DataLad placeholders and the run is refused
// ("tuple index out of range" / "command has an unrecognized placeholder"); doubled braces run literally.
test('braces in the command are doubled so that what is typed is what runs', async () => {
  const runner = new Runner()
  await new DataLadAdapter({ runner }).runCommand('run', { ...ok, command: "awk '{print $1}' t.txt > o.txt; echo ${X}" })
  assert.equal(runner.calls[0].args.at(-1), "awk '{{print $1}}' t.txt > o.txt; echo ${{X}}")
})

test('a command or message that looks like an option is refused', () => {
  assert.throws(() => assertCommandRequest('run', { ...ok, command: '--help' }), /command cannot start with -/)
  assert.throws(() => assertCommandRequest('run', { ...ok, command: '   -v' }), /command cannot start with -/)
  assert.doesNotThrow(() => assertCommandRequest('run', { ...ok, command: 'echo -- -x' }))
  assert.throws(() => assertCommandRequest('run', { ...ok, message: '--amend' }), /message cannot start with -/)
})

test('run requests are checked before anything starts', () => {
  assert.throws(() => assertCommandRequest('run', { ...ok, command: '' }), /missing required field command/)
  assert.throws(() => assertCommandRequest('run', { ...ok, command: '   ' }), /command must not be empty/)
  assert.throws(() => assertCommandRequest('run', { ...ok, command: 7 }), /command must be a string/)
  assert.throws(() => assertCommandRequest('run', { ...ok, command: 'a\0b' }), /command must not contain/)
  assert.throws(() => assertCommandRequest('run', { ...ok, command: 'x'.repeat(10_001) }), /command is too long/)
  assert.doesNotThrow(() => assertCommandRequest('run', { ...ok, command: 'x'.repeat(10_000) }))
  assert.throws(() => assertCommandRequest('run', { ...ok, inputs: 'a.csv' }), /inputs must be an array/)
  assert.throws(() => assertCommandRequest('run', { ...ok, outputs: [3] }), /each outputs entry must be a non-empty string/)
  assert.throws(() => assertCommandRequest('run', { ...ok, inputs: Array.from({ length: 201 }, (_, i) => `f${i}`) }), /at most 200 inputs/)
  for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:\\x', 'a\0b', '..\\x']) {
    assert.throws(() => assertCommandRequest('run', { ...ok, outputs: [bad] }), /outputs must be paths inside the project/, bad)
    assert.throws(() => assertCommandRequest('run', { ...ok, inputs: [bad] }), /inputs must be paths inside the project/, bad)
  }
  assert.doesNotThrow(() => assertCommandRequest('run', { ...ok, inputs: ['data/*.csv', 'my file.csv', '.hidden/x'] }))
})

// Texts captured from real `datalad run` on 2026-10-13.
const dirty = 'run(impossible): /tmp/p (dataset) [clean dataset required to detect changes from command; use `datalad status` to inspect unsaved changes]'
const missing = 'run(error): /tmp/p (dataset) [Input did not match existing file: nope.txt]'
const failed = "[INFO] The command had a non-zero exit code. If this is expected, you can save the changes with 'datalad save -d . -r -F .git/COMMIT_EDITMSG' \nrun(error): /tmp/p (dataset) [false]"

test('run failures become friendly messages', () => {
  const result = (stdout, stderr = '') => ({ failed: true, exitCode: 1, stdout, stderr })
  assert.equal(mapCommandError('run', result(dirty)).code, 'RUN_NEEDS_CLEAN')
  assert.match(mapCommandError('run', result(dirty)).message, /Save your changes first/)
  const input = mapCommandError('run', result(missing))
  assert.equal(input.code, 'RUN_INPUT_MISSING')
  assert.match(input.message, /nope\.txt/)
  assert.equal(mapCommandError('run', result('', failed)).code, 'RUN_COMMAND_FAILED')
  assert.equal(mapCommandError('run', result(failed)).code, 'RUN_COMMAND_FAILED')
  assert.match(mapCommandError('run', result(failed)).message, /nothing was recorded/i)
  assert.equal(mapCommandError('run', { failed: true, cancelled: true, stdout: '', stderr: '' }).code, 'CANCELLED')
})

test('other commands are not given run messages', () => {
  assert.notEqual(mapCommandError('save', { failed: true, exitCode: 1, stdout: dirty, stderr: '' }).code, 'RUN_NEEDS_CLEAN')
})

test('a recorded run is never retried on a lock message in its output', async () => {
  const runner = new Runner()
  await new DataLadAdapter({ runner }).runCommand('run', ok)
  assert.equal(runner.calls[0].options.retryOnLock, false)
})

// What the native confirmation shows must be what runs: nothing that can hide or disguise text.
test('a command cannot hide itself from the confirmation dialog', () => {
  for (const [label, command] of [
    ['a right-to-left override', 'echo ‮src.txt'],
    ['a bidi isolate', 'echo ⁦x⁩'],
    ['a zero-width space', 'echo a​b'],
    ['a bell character', 'echo \u0007'],
    ['an escape character', 'echo \u001b[2J'],
    ['a C1 control', 'echo \u0085x'],
    ['a carriage return', 'echo safe\rcurl evil']
  ]) {
    assert.throws(() => assertCommandRequest('run', { ...ok, command }), /command must not contain/, label)
  }
  assert.doesNotThrow(() => assertCommandRequest('run', { ...ok, command: 'echo "Größe ä"\n\tawk 1' }))
})

test('a command of more than 20 lines is refused, so its tail cannot fall below the dialog', () => {
  assert.doesNotThrow(() => assertCommandRequest('run', { ...ok, command: Array.from({ length: 20 }, (_, i) => `echo ${i}`).join('\n') }))
  assert.throws(() => assertCommandRequest('run', { ...ok, command: Array.from({ length: 21 }, (_, i) => `echo ${i}`).join('\n') }), /at most 20 lines/)
})

test('on Windows a command is one line (cmd.exe stops at the first line break)', () => {
  assert.throws(() => assertCommandRequest('run', { ...ok, command: 'echo a\necho b' }, { platform: 'win32' }), /one line on Windows/)
  assert.doesNotThrow(() => assertCommandRequest('run', { ...ok, command: 'echo a\necho b' }, { platform: 'linux' }))
  assert.doesNotThrow(() => assertCommandRequest('run', { ...ok, command: 'echo a && echo b' }, { platform: 'win32' }))
})
