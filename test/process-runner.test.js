import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProcessRunner } from '../src/datalad/process-runner.js'
import { QUIT_ABORT_REASON } from '../src/datalad/kill-tree.js'

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

test('ProcessRunner kills a process that outlives timeoutMs and reports it as failed', async () => {
  const runner = new ProcessRunner()
  const startedAt = Date.now()
  const result = await runner.run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    timeoutMs: 200
  })

  assert.equal(result.failed, true)
  assert.equal(result.exitCode, 124)
  assert.match(result.stderr, /timed out after 200ms/)
  assert.ok(Date.now() - startedAt < 5000)
})

test('ProcessRunner leaves a process that finishes within timeoutMs alone', async () => {
  const runner = new ProcessRunner()
  const result = await runner.run(process.execPath, ['-e', "process.stdout.write('ok')"], {
    timeoutMs: 10_000
  })

  assert.equal(result.failed, false)
  assert.equal(result.stdout, 'ok')
})

async function waitFor(check, { timeoutMs = 5000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) {
      return value
    }
    if (Date.now() > deadline) {
      throw new Error('waitFor timed out')
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

const readIfExists = (file) => readFile(file, 'utf8').catch(() => '')

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// A child that spawns a long-lived grandchild, records the grandchild's pid,
// then idles itself - the shape of `datalad` spawning `git`/`git-annex`.
function childWithGrandchildScript(pidFile) {
  return (
    "const { spawn } = require('child_process'); const fs = require('fs');" +
    "const g = spawn(process.execPath, ['-e', 'setInterval(function () {}, 1000)'], { stdio: 'ignore' });" +
    `fs.writeFileSync(${JSON.stringify(pidFile)}, String(g.pid)); setInterval(function () {}, 1000)`
  )
}

test('ProcessRunner cancel kills the child and its grandchild', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'process-runner-cancel-'))
  const pidFile = join(dir, 'grandchild.pid')
  const controller = new AbortController()
  const running = new ProcessRunner().run(
    process.execPath,
    ['-e', childWithGrandchildScript(pidFile)],
    { signal: controller.signal }
  )

  const grandchildPid = Number(await waitFor(() => readIfExists(pidFile)))
  controller.abort()
  const result = await running

  assert.equal(result.cancelled, true)
  assert.equal(result.failed, true)
  assert.equal(result.exitCode, 130)
  await waitFor(() => !isAlive(grandchildPid))
})

test('ProcessRunner with an already-aborted signal never spawns', async () => {
  const controller = new AbortController()
  controller.abort()
  const result = await new ProcessRunner().run('definitely-not-a-real-binary-xyz', [], {
    signal: controller.signal
  })

  assert.equal(result.cancelled, true)
  assert.equal(result.exitCode, 130)
})

test('ProcessRunner timeoutMs also kills the grandchild', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'process-runner-timeout-tree-'))
  const pidFile = join(dir, 'grandchild.pid')
  const result = await new ProcessRunner().run(
    process.execPath,
    ['-e', childWithGrandchildScript(pidFile)],
    { timeoutMs: 1500 }
  )

  assert.equal(result.exitCode, 124)
  assert.notEqual(result.cancelled, true)
  const grandchildPid = Number(await readIfExists(pidFile))
  assert.ok(grandchildPid > 0, 'grandchild should have started')
  await waitFor(() => !isAlive(grandchildPid))
})

// POSIX only: Windows has no SIGTERM, so cancel there is an immediate taskkill.
test(
  'ProcessRunner cancel sends SIGTERM first so git can remove its own locks',
  { skip: process.platform === 'win32' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'process-runner-term-'))
    const ready = join(dir, 'ready')
    const marker = join(dir, 'got-sigterm')
    const script =
      "const fs = require('fs');" +
      `process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(marker)}, 'term'); process.exit(0) });` +
      `fs.writeFileSync(${JSON.stringify(ready)}, 'ready'); setInterval(function () {}, 1000)`
    const controller = new AbortController()
    const running = new ProcessRunner().run(process.execPath, ['-e', script], {
      signal: controller.signal
    })

    await waitFor(() => readIfExists(ready))
    controller.abort()
    const result = await running

    assert.equal(result.cancelled, true)
    assert.equal(await readIfExists(marker), 'term')
  }
)

test(
  'ProcessRunner escalates to SIGKILL when the child ignores SIGTERM',
  { skip: process.platform === 'win32' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'process-runner-kill-'))
    const pidFile = join(dir, 'pid')
    const script =
      `process.on('SIGTERM', () => {}); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));` +
      'setInterval(function () {}, 1000)'
    const controller = new AbortController()
    const running = new ProcessRunner().run(process.execPath, ['-e', script], {
      signal: controller.signal,
      killGraceMs: 200
    })

    const pid = Number(await waitFor(() => readIfExists(pidFile)))
    controller.abort()
    const result = await running

    assert.equal(result.cancelled, true)
    // The runner's failsafe resolves the run either way, so prove the process
    // itself is really dead: only SIGKILL can kill it.
    await waitFor(() => !isAlive(pid))
  }
)

// Review finding: the SIGKILL fallback used to be cleared as soon as the direct
// child closed, leaving a grandchild that ignores SIGTERM alive (and outliving
// the "cancelled" result).
test(
  'ProcessRunner still SIGKILLs a SIGTERM-ignoring grandchild after the child has exited',
  { skip: process.platform === 'win32' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'process-runner-grandchild-kill-'))
    const pidFile = join(dir, 'grandchild.pid')
    // The grandchild writes its own pid only after installing its SIGTERM
    // handler, so the abort cannot race the handler's installation.
    const grandchild =
      `process.on('SIGTERM', () => {}); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));` +
      'setInterval(function () {}, 1000)'
    const script =
      "const { spawn } = require('child_process');" +
      `spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' }); setInterval(function () {}, 1000)`
    const controller = new AbortController()
    const running = new ProcessRunner().run(process.execPath, ['-e', script], {
      signal: controller.signal,
      killGraceMs: 200
    })

    const grandchildPid = Number(await waitFor(() => readIfExists(pidFile)))
    controller.abort()
    await running

    await waitFor(() => !isAlive(grandchildPid))
  }
)

// Review focus 5: on quit nobody is left to fire a delayed SIGKILL, so an
// app-quit abort must SIGKILL at once instead of waiting out the grace period.
test(
  'ProcessRunner SIGKILLs immediately when aborted because the app is quitting',
  { skip: process.platform === 'win32' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'process-runner-quit-'))
    const pidFile = join(dir, 'pid')
    const script =
      `process.on('SIGTERM', () => {}); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));` +
      'setInterval(function () {}, 1000)'
    const controller = new AbortController()
    const running = new ProcessRunner().run(process.execPath, ['-e', script], {
      signal: controller.signal,
      killGraceMs: 60_000
    })

    const pid = Number(await waitFor(() => readIfExists(pidFile)))
    controller.abort(QUIT_ABORT_REASON)

    await waitFor(() => !isAlive(pid), { timeoutMs: 3000 })
    assert.equal((await running).cancelled, true)
  }
)

test('ProcessRunner reports the latest line of each output chunk via onOutput', async () => {
  const lines = []
  const script =
    "process.stdout.write('first line\\n');" +
    "setTimeout(() => process.stdout.write('10%\\r50%\\r75%\\r'), 300);" +
    "setTimeout(() => process.stderr.write('warning: something\\n'), 600)"
  const result = await new ProcessRunner().run(process.execPath, ['-e', script], {
    onOutput: (line) => lines.push(line)
  })

  assert.equal(result.failed, false)
  assert.deepEqual(lines, ['first line', '75%', 'warning: something'])
  // Output is still fully buffered for the final result.
  assert.match(result.stdout, /first line/)
  assert.match(result.stderr, /warning: something/)
})

test('ProcessRunner ignores chunks that contain no visible text', async () => {
  const lines = []
  await new ProcessRunner().run(process.execPath, ['-e', "process.stdout.write('\\n\\r  \\n')"], {
    onOutput: (line) => lines.push(line)
  })

  assert.deepEqual(lines, [])
})

// Review minor #7: a command that already finished (exit 0) while a helper kept
// its output pipes open must not be reported as "Stopped by you" because the
// user clicked Cancel in that window - the work completed.
test('ProcessRunner keeps the real result when cancel arrives after the command already exited', async () => {
  const script =
    "const { spawn } = require('child_process');" +
    "spawn(process.execPath, ['-e', 'setTimeout(function () {}, 1500)'], { stdio: 'inherit' }).unref();" +
    "process.stdout.write('saved\\n')"
  const controller = new AbortController()
  const running = new ProcessRunner().run(process.execPath, ['-e', script], {
    signal: controller.signal,
    onOutput: (line) => {
      if (line === 'saved') {
        // The child exits right after printing; abort once it has exited but
        // before its helper releases the pipes (so `close` has not fired yet).
        setTimeout(() => controller.abort(), 400)
      }
    }
  })

  const result = await running

  assert.notEqual(result.cancelled, true)
  assert.equal(result.exitCode, 0)
  assert.equal(result.failed, false)
})

// Review minor #5: the spec requires that a cancelled run is never lock-retried.
test('ProcessRunner does not retry a cancelled run that had printed an index.lock error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'process-runner-cancel-lock-'))
  const counter = join(dir, 'counter')
  await writeFile(counter, '0')
  const script =
    "const fs = require('fs'); const f = process.argv[1];" +
    "fs.writeFileSync(f, String(parseInt(fs.readFileSync(f, 'utf8'), 10) + 1));" +
    "process.stderr.write(\"fatal: Unable to create '/tmp/x/.git/index.lock': File exists.\\n\");" +
    'setInterval(function () {}, 1000)'
  const controller = new AbortController()
  const running = new ProcessRunner().run(process.execPath, ['-e', script, counter], {
    signal: controller.signal,
    onOutput: (line) => {
      if (line.includes('index.lock')) {
        controller.abort()
      }
    }
  })

  const result = await running
  await new Promise((resolve) => setTimeout(resolve, 600))

  assert.equal(result.cancelled, true)
  assert.equal(await readFile(counter, 'utf8'), '1', 'a cancelled run must not be re-spawned by the lock retry')
})

test('ProcessRunner spawns the resolved absolute path, not the bare name', async () => {
  const runner = new ProcessRunner({
    resolve: (name) => (name === 'fake-tool' ? process.execPath : null)
  })
  const result = await runner.run('fake-tool', ['-e', "process.stdout.write('ok')"])
  assert.equal(result.stdout, 'ok')
})

test('ProcessRunner on win32 refuses an unresolvable bare name instead of searching cwd', async () => {
  const runner = new ProcessRunner({ resolve: () => null, platform: 'win32' })
  const result = await runner.run('datalad', ['--version'], { cwd: process.cwd() })
  assert.equal(result.failed, true)
  assert.equal(result.exitCode, 127)
  assert.match(result.stderr, /not found on PATH/i)
})

test('ProcessRunner tells children not to search the current directory for executables', async () => {
  const saved = process.env.NoDefaultCurrentDirectoryInExePath
  delete process.env.NoDefaultCurrentDirectoryInExePath
  try {
    const result = await new ProcessRunner().run(process.execPath, [
      '-e',
      'process.stdout.write(process.env.NoDefaultCurrentDirectoryInExePath ?? "")'
    ])
    assert.equal(result.stdout, '1')
  } finally {
    if (saved !== undefined) process.env.NoDefaultCurrentDirectoryInExePath = saved
  }
})

test('ProcessRunner makes git treat pathspecs literally', async () => {
  const result = await new ProcessRunner().run(process.execPath, [
    '-e',
    'process.stdout.write(process.env.GIT_LITERAL_PATHSPECS ?? "")'
  ])
  assert.equal(result.stdout, '1')
})

test('ProcessRunner overrides core.fsmonitor for git children, keeping any inherited GIT_CONFIG_COUNT entries', async () => {
  const result = await new ProcessRunner().run(
    process.execPath,
    ['-e', 'const e = process.env; process.stdout.write(JSON.stringify([e.GIT_CONFIG_COUNT, e.GIT_CONFIG_KEY_1, e.GIT_CONFIG_VALUE_1, e.GIT_CONFIG_KEY_0]))'],
    { env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'x' } }
  )
  assert.deepEqual(JSON.parse(result.stdout), ['2', 'core.fsmonitor', 'false', 'user.name'])
})

test('ProcessRunner fsmonitor override really stops a repo config from running code', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fsm-'))
  const marker = join(dir, 'PWNED')
  const runner = new ProcessRunner()
  await runner.run('git', ['init', '-q', dir])
  await runner.run('git', ['-C', dir, 'config', 'core.fsmonitor', `touch ${marker}`])
  await runner.run('git', ['-C', dir, 'status', '--porcelain'])
  await assert.rejects(readFile(marker), /ENOENT/)
})

test('ProcessRunner stops a command whose output exceeds the cap instead of buffering without limit', async () => {
  const runner = new ProcessRunner()
  const result = await runner.run(
    process.execPath,
    ['-e', "const chunk = 'x'.repeat(10000); setInterval(() => process.stdout.write(chunk), 1)"],
    { maxOutputBytes: 100_000 }
  )
  assert.equal(result.failed, true)
  assert.equal(result.exitCode, 125)
  assert.match(result.stderr, /output exceeded 100000 bytes/i)
  assert.ok(result.stdout.length < 1_000_000, 'buffered far past the cap')
})

// POSIX execvp would honour an empty or relative PATH entry (a trailing ':') and run ./datalad from the dataset.
test('ProcessRunner refuses an unresolvable bare name on every platform, not just win32', async () => {
  const runner = new ProcessRunner({ resolve: () => null, platform: 'linux' })
  const result = await runner.run('datalad', ['--version'])
  assert.equal(result.failed, true)
  assert.equal(result.exitCode, 127)
  assert.match(result.stderr, /not found on PATH/i)
})
