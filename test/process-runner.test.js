import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HOOKS_DIR, ProcessRunner, resolveHooksDir } from '../src/datalad/process-runner.js'
import { taskkillPath } from '../src/datalad/kill-tree.js'
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
    ['-e', 'const e = process.env; process.stdout.write(JSON.stringify([e.GIT_CONFIG_COUNT, e.GIT_CONFIG_KEY_1, e.GIT_CONFIG_VALUE_1, e.GIT_CONFIG_KEY_2, e.GIT_CONFIG_KEY_3, e.GIT_CONFIG_KEY_0]))'],
    { env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'x' } }
  )
  assert.deepEqual(JSON.parse(result.stdout), ['4', 'core.fsmonitor', 'false', 'core.hooksPath', 'safe.bareRepository', 'user.name'])
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

test('ProcessRunner tells datalad to ignore procedures shipped inside a dataset', async () => {
  const runner = new ProcessRunner()
  const result = await runner.run(process.execPath, ['-e', 'process.stdout.write(process.env.DATALAD_LOCATIONS_DATASET__PROCEDURES ?? "")'])
  assert.equal(result.stdout, process.execPath)
})

const hasDatalad = (() => { try { execFileSync('datalad', ['--version'], { stdio: 'ignore' }); return true } catch { return false } })()

// Regression for the 2026-10-03 finding: adopting a folder that is already a dataset ran its own cfg_text2git.
test("create -c text2git --force on an existing dataset runs datalad's procedure, not the dataset's", { skip: !hasDatalad && 'datalad not installed' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proc-'))
  const ds = join(dir, 'adopted')
  const marker = join(dir, 'shipped-procedure-ran')
  execFileSync('datalad', ['create', '-c', 'text2git', ds], { stdio: 'ignore' })
  mkdirSync(join(ds, '.datalad', 'procedures'), { recursive: true })
  const script = process.platform === 'win32'
    ? ['cfg_text2git.py', `open(r"${marker}", "w").close()\n`]
    : ['cfg_text2git.sh', `#!/bin/sh\ntouch '${marker}'\n`]
  await writeFile(join(ds, '.datalad', 'procedures', script[0]), script[1])
  execFileSync('datalad', ['save', '-d', ds, '-m', 'ship procedure'], { stdio: 'ignore' })

  const runner = new ProcessRunner()
  const result = await runner.run('datalad', ['create', '-c', 'text2git', '--force', '--', ds])

  assert.equal(result.failed, false, result.stderr)
  assert.equal(existsSync(marker), false, 'the dataset-shipped procedure ran')
  assert.match(await readFile(join(ds, '.gitattributes'), 'utf8'), /annex\.largefiles/) // built-in text2git still applied
})

test('ProcessRunner points git at the app-owned hooks folder', async () => {
  const result = await new ProcessRunner().run(process.execPath, ['-e',
    'const n=+process.env.GIT_CONFIG_COUNT;const o={};for(let i=0;i<n;i++)o[process.env["GIT_CONFIG_KEY_"+i]]=process.env["GIT_CONFIG_VALUE_"+i];process.stdout.write(o["core.hooksPath"]??"")'])
  assert.equal(result.stdout, HOOKS_DIR)
})

test("a repository's own hook does not run when the app commits", { skip: process.platform === 'win32' && 'POSIX hook script' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hooks-'))
  const marker = join(dir, 'hook-ran')
  execFileSync('git', ['init', '-q', dir])
  const hook = join(dir, '.git', 'hooks', 'pre-commit')
  await writeFile(hook, `#!/bin/sh\ntouch '${marker}'\n`)
  chmodSync(hook, 0o755)
  await new ProcessRunner().run('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t.t', 'commit', '-q', '--allow-empty', '-m', 'x'])
  assert.equal(existsSync(marker), false, "the repository's own pre-commit hook ran")
})

test('the app-owned hooks folder holds exactly the stock git-annex hooks', () => {
  const names = readdirSync(HOOKS_DIR)
  assert.ok(names.includes('pre-commit'))
  for (const name of names) {
    assert.match(readFileSync(join(HOOKS_DIR, name), 'utf8'), /^#!\/bin\/sh\n# automatically configured by git-annex\n/, name)
  }
})

test('ProcessRunner blanks datalad.clone.reckless for every child', async () => {
  const r = await new ProcessRunner().run(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env.DATALAD_CLONE_RECKLESS))'])
  assert.equal(r.stdout, '""')
})

test("a cloned dataset's committed reckless setting does not loosen its subdatasets' permissions", { skip: (!hasDatalad || process.platform === 'win32') && 'needs datalad on POSIX' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reckless-'))
  const src = join(dir, 'src')
  execFileSync('datalad', ['create', src], { stdio: 'ignore' })
  execFileSync('datalad', ['create', '-d', src, join(src, 'sub')], { stdio: 'ignore' })
  execFileSync('git', ['config', '--file', join(src, '.datalad', 'config'), 'datalad.clone.reckless', 'shared-0777'])
  execFileSync('datalad', ['save', '-d', src, '-m', 'x'], { stdio: 'ignore' })
  const dest = join(dir, 'dest')
  const r = await new ProcessRunner().run('datalad', ['install', '-r', '-s', src, '--', dest])
  assert.equal(r.failed, false, r.stderr)
  let shared = ''
  try { shared = execFileSync('git', ['-C', join(dest, 'sub'), 'config', '--get', 'core.sharedrepository']).toString().trim() } catch { /* unset: the passing case */ }
  assert.notEqual(shared, '0666')
})

test('taskkill is started by absolute path, not looked up in a dataset-controlled folder', () => {
  const src = readFileSync(new URL('../src/datalad/kill-tree.js', import.meta.url), 'utf8')
  assert.match(src, /SystemRoot[^\n]*System32[^\n]*taskkill\.exe/)
})

// A Windows checkout converts line endings by default, and `#!/bin/sh\r` fails under git's shell:
// every git-annex hook would break. The hooks must be checked out (and packaged) with LF.
test('the git hooks keep LF line endings on every checkout', () => {
  const attributes = readFileSync(new URL('../.gitattributes', import.meta.url), 'utf8')
  assert.match(attributes, /^build\/git-hooks\/\*\s+text\s+eol=lf\s*$/m)
  for (const name of readdirSync(HOOKS_DIR)) {
    assert.doesNotMatch(readFileSync(join(HOOKS_DIR, name), 'utf8'), /\r/, `${name} has CRLF line endings`)
  }
})

test('the hooks folder is resources/git-hooks in a packaged app and build/git-hooks otherwise', () => {
  assert.equal(resolveHooksDir({ resourcesPath: join('res'), exists: () => true }), join('res', 'git-hooks'))
  assert.match(resolveHooksDir({ resourcesPath: join('res'), exists: () => false }), /build[\\/]git-hooks$/)
  assert.match(resolveHooksDir({ resourcesPath: undefined, exists: () => true }), /build[\\/]git-hooks$/)
})

test('taskkill comes from the Windows system folder, wherever Windows lives', () => {
  assert.ok(taskkillPath({ SystemRoot: 'D:\\Win' }).startsWith('D:\\Win'))
  assert.match(taskkillPath({ SystemRoot: 'D:\\Win' }), /System32[\\/]taskkill\.exe$/)
  assert.ok(taskkillPath({}).startsWith('C:\\Windows'))
})

// Regression from the review of the hooks design: the shipped hooks ran `git annex ...` in every
// repository, so a plain git project (or `datalad create --no-annex`) could no longer commit.
test('the app can commit in a repository that does not use git-annex', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plain-'))
  execFileSync('git', ['init', '-q', dir])
  await writeFile(join(dir, 'a.txt'), 'x')
  const runner = new ProcessRunner()
  await runner.run('git', ['-C', dir, 'add', 'a.txt'])
  const result = await runner.run('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t.t', 'commit', '-q', '-m', 'x'])
  assert.equal(result.failed, false, result.stderr)
})

test('every shipped hook does nothing in a repository that has no git-annex uuid', () => {
  for (const name of readdirSync(HOOKS_DIR)) {
    assert.match(readFileSync(join(HOOKS_DIR, name), 'utf8'), /\ngit config --get annex\.uuid >\/dev\/null 2>&1 \|\| exit 0\n/, name)
  }
})

// A folder laid out like a bare git directory (HEAD, objects, refs, config) can name a work tree elsewhere
// and carry its own filters and attributes. Git must only use a repository it finds as `.git`.
test('git refuses a bare-format folder it would find by looking at the current directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bare-format-'))
  const proj = join(dir, 'proj')
  execFileSync('git', ['init', '-q', '--bare', proj])
  mkdirSync(join(dir, 'data'))
  await writeFile(join(proj, 'config'), '[core]\n\tbare = false\n\tworktree = ../data\n\trepositoryformatversion = 0\n')
  const result = await new ProcessRunner().run('git', ['-C', proj, 'status', '--porcelain'])
  assert.equal(result.failed, true)
  assert.match(result.stderr, /bare repository/i)
})

test('pushing to, cloning from and fetching from local bare and work-tree remotes still works', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'remotes-'))
  const runner = new ProcessRunner()
  const git = (...args) => runner.run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.t', ...args])
  execFileSync('git', ['init', '-q', '--bare', join(dir, 'bare.git')])
  const clone = join(dir, 'clone')
  assert.equal((await git('clone', '-q', join(dir, 'bare.git'), clone)).failed, false)
  await writeFile(join(clone, 'a.txt'), 'x')
  await git('-C', clone, 'add', 'a.txt')
  assert.equal((await git('-C', clone, 'commit', '-q', '-m', 'x')).failed, false)
  const pushed = await git('-C', clone, 'push', '-q', 'origin', 'HEAD')
  assert.equal(pushed.failed, false, pushed.stderr)
  const second = join(dir, 'second')
  assert.equal((await git('clone', '-q', join(dir, 'bare.git'), second)).failed, false)
  assert.equal((await git('-C', second, 'fetch', '-q')).failed, false)
  // a work-tree remote
  const work = join(dir, 'work')
  execFileSync('git', ['init', '-q', work])
  execFileSync('git', ['-C', work, 'config', 'receive.denyCurrentBranch', 'updateInstead'])
  assert.equal((await git('-C', clone, 'push', '-q', work, 'HEAD:refs/heads/main')).failed, false)
})
