import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

test('ProcessRunner retries transient .git/index.lock contention and succeeds once it clears', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'process-runner-lock-'))
  const counterFile = join(dir, 'counter')
  await writeFile(counterFile, '0')

  // Simulates two other processes racing for the same lock before it frees
  // up on the third attempt — exactly the shape of the real bug (background
  // status refreshes overlapping a multi-step automated git sequence).
  const script =
    "const fs = require('fs'); const f = process.argv[1]; " +
    'const n = parseInt(fs.readFileSync(f, "utf8"), 10) + 1; fs.writeFileSync(f, String(n)); ' +
    'if (n < 3) { process.stderr.write("fatal: Unable to create \'/tmp/fake/.git/index.lock\': File exists.\\n"); process.exit(128); } ' +
    'process.stdout.write("ok");'

  const runner = new ProcessRunner()
  const result = await runner.run(process.execPath, ['-e', script, counterFile])

  assert.equal(result.failed, false)
  assert.equal(result.stdout, 'ok')
  assert.equal(await readFile(counterFile, 'utf8'), '3')
})

test('ProcessRunner gives up and reports failure after persistent index.lock contention', async () => {
  const script =
    'process.stderr.write("fatal: Unable to create \'/tmp/fake/.git/index.lock\': File exists.\\n"); ' +
    'process.exit(128);'

  const runner = new ProcessRunner()
  const result = await runner.run(process.execPath, ['-e', script])

  assert.equal(result.failed, true)
  assert.match(result.stderr, /index\.lock/)
})
