import test from 'node:test'
import assert from 'node:assert/strict'
import { ProcessRunner } from '../src/datalad/process-runner.js'

test('ProcessRunner resolves stdout and a zero exit code on success', async () => {
  const runner = new ProcessRunner()
  const result = await runner.run(process.execPath, ['-e', "process.stdout.write('hello')"])

  assert.equal(result.failed, false)
  assert.equal(result.exitCode, 0)
  assert.equal(result.stdout, 'hello')
})

test('ProcessRunner captures stderr and marks non-zero exit codes as failed', async () => {
  const runner = new ProcessRunner()
  const result = await runner.run(process.execPath, [
    '-e',
    "process.stderr.write('boom'); process.exitCode = 2"
  ])

  assert.equal(result.failed, true)
  assert.equal(result.exitCode, 2)
  assert.equal(result.stderr, 'boom')
})

test('ProcessRunner reports a synthetic exit code when the executable cannot be spawned', async () => {
  const runner = new ProcessRunner()
  const result = await runner.run('definitely-not-a-real-binary-xyz', [])

  assert.equal(result.failed, true)
  assert.equal(result.exitCode, 127)
  assert.match(result.stderr, /ENOENT|not found/i)
})

test('ProcessRunner merges extra env vars and respects cwd', async () => {
  const runner = new ProcessRunner()
  const result = await runner.run(
    process.execPath,
    ['-e', 'process.stdout.write(process.env.PROCESS_RUNNER_TEST_VAR || "")'],
    { cwd: process.cwd(), env: { PROCESS_RUNNER_TEST_VAR: 'present' } }
  )

  assert.equal(result.stdout, 'present')
})
