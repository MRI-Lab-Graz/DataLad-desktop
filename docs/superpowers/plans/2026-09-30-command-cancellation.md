# Command Cancellation + Live Activity Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a researcher cancel any running DataLad/git command (curated actions and the power-user console) and see the latest line of its output while it runs.

**Architecture:** The renderer creates a `runId` per command. The main process keeps a `runId -> AbortController` registry and passes an `AbortSignal` plus an `onOutput` callback down to `ProcessRunner`, which kills the whole process tree on abort and streams the latest output line back over a `command:activity` IPC event. One shared "running" strip in the renderer shows a row (label, latest line, Cancel) per active run.

**Tech Stack:** Node built-ins only (`AbortSignal`, `child_process.spawn`, `taskkill`), Electron IPC, `node:test`, Playwright-over-CDP e2e (existing driver).

**Spec:** `docs/superpowers/specs/2026-09-30-command-cancellation-design.md` (approved). Read it first; this plan implements it task by task.

## Global Constraints

- Zero new npm dependencies (repo posture: prefer Node built-ins).
- ESM everywhere; code style of the surrounding files: 2-space indent, no semicolons, single quotes.
- Node `>=20` (`engines` in package.json); CI runs Node 22.
- Tests use `node:test` + `node:assert/strict`; unit tests live in `test/*.test.js` (run by `npm test`), real-Electron tests in `e2e/*.e2e.mjs` (run by `npm run test:e2e`, launch with `env -u ELECTRON_RUN_AS_NODE`).
- Every new function gets a failing test first (repo rule: TDD). Watch each test fail for the expected reason before implementing.
- Windows cancel is `taskkill /pid <pid> /T /F` (no graceful shutdown); POSIX is SIGTERM to the process group then SIGKILL after `killGraceMs` (default 3000).
- A cancelled run resolves to `{ failed: true, cancelled: true, exitCode: 130 }` with the output captured so far; it is never reported as an error banner.
- Timeouts keep exit code 124 and are not "cancelled".
- Activity lines are untrusted process output: always HTML-escape before rendering.
- The Rust adapter path (opt-in feature flag) ignores the extra `runCommand` argument, so Cancel is a no-op there. Known limitation, out of scope.
- Commits: the maintainer commits and pushes. Each task ends with a checkpoint step that gives the suggested commit message; ask before committing.

## Review Focus

Failure modes the spec implies that no happy-path test would catch (each has a pinning test in the task that owns the code):

1. Cancel arrives after the process already exited (click racing completion): must be a silent `false`, not an error (Task 4 `cancel` test, Task 5 e2e second cancel).
2. A process prints HTML or terminal escape codes into the activity line: must render as inert text (Task 6 escaping test).
3. A non-string, empty, hostile or duplicate `runId` reaches the main process: rejected at `register`, nothing registered (Task 4 validation tests).
4. Cancel during BIDS nesting (a loop of many runs): the loop stops and the parent project is not saved (Task 6 `shouldStopSequence`, Task 7 loop edit).
5. App quits mid-command: every active run is aborted so no orphan `git`/`datalad` survives (Task 4 `abortAll`, Task 5 `before-quit`).

---

### Task 1: Tree-kill and abort signal in ProcessRunner

**Files:**
- Create: `src/datalad/kill-tree.js`
- Modify: `src/datalad/process-runner.js` (imports, `run`, `#runOnce`)
- Test: `test/process-runner.test.js` (append)

**Interfaces:**
- Produces: `killProcessTree(child, graceMs = 3000): void` from `src/datalad/kill-tree.js`.
- Produces: `ProcessRunner.run(command, args, options)` now honours `options.signal` (AbortSignal), `options.killGraceMs` (number, default 3000) and `options.timeoutMs` (existing). A cancelled run resolves `{ command, args, exitCode: 130, stdout, stderr, failed: true, cancelled: true, durationMs }`.

- [ ] **Step 1: Write the failing tests**

Append to `test/process-runner.test.js` (add `readFile` is already imported; the file already imports `mkdtemp, readFile, writeFile`, `tmpdir`, `join`, `ProcessRunner`):

```js
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
    const ready = join(dir, 'ready')
    const script =
      `process.on('SIGTERM', () => {}); require('fs').writeFileSync(${JSON.stringify(ready)}, 'ready');` +
      'setInterval(function () {}, 1000)'
    const controller = new AbortController()
    const startedAt = Date.now()
    const running = new ProcessRunner().run(process.execPath, ['-e', script], {
      signal: controller.signal,
      killGraceMs: 200
    })

    await waitFor(() => readIfExists(ready))
    controller.abort()
    const result = await running

    assert.equal(result.cancelled, true)
    assert.ok(Date.now() - startedAt < 4000, 'should not wait for the child to exit on its own')
  }
)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/process-runner.test.js`
Expected: the new tests FAIL (abort is ignored, so the cancel tests time out in `waitFor`/hang until the runner's default; the pre-aborted test gets exit code 127 instead of 130). If the run hangs, stop it with Ctrl-C and `pkill -f "setInterval"`; a hang is the expected failure for "cancel is ignored".

- [ ] **Step 3: Write `src/datalad/kill-tree.js`**

```js
import { spawn } from 'node:child_process'

// Kills `child` and everything it spawned.
// POSIX: the child was spawned `detached`, so it leads its own process group.
// SIGTERM the group first (git and git-annex remove their own .git/index.lock on
// SIGTERM), then SIGKILL after graceMs for anything that ignores it.
// Windows has no graceful equivalent for console processes: taskkill /T /F.
export function killProcessTree(child, graceMs = 3000) {
  if (child.pid === undefined) {
    return
  }

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => {})
    return
  }

  signalGroup(child.pid, 'SIGTERM')
  const timer = setTimeout(() => signalGroup(child.pid, 'SIGKILL'), graceMs)
  timer.unref()
  child.once('close', () => clearTimeout(timer))
}

function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal)
  } catch {
    // The group is already gone.
  }
}
```

- [ ] **Step 4: Rewrite `run` and `#runOnce` in `src/datalad/process-runner.js`**

Add the import after the existing imports:

```js
import { killProcessTree } from './kill-tree.js'
```

Add next to the other constants (below `LOCK_RETRY_BASE_DELAY_MS`):

```js
const CANCELLED_EXIT_CODE = 130
const DEFAULT_KILL_GRACE_MS = 3000
```

Replace the whole `run` method and the whole `#runOnce` method with:

```js
  async run(command, args = [], options = {}) {
    const startedAt = Date.now()

    for (let attempt = 0; ; attempt += 1) {
      const result = await this.#runOnce(command, args, options)

      if (
        result.failed &&
        !result.cancelled &&
        attempt < MAX_LOCK_RETRIES &&
        INDEX_LOCK_PATTERN.test(result.stderr)
      ) {
        await sleep(LOCK_RETRY_BASE_DELAY_MS * (attempt + 1))
        continue
      }

      return { ...result, durationMs: Date.now() - startedAt }
    }
  }

  async #runOnce(command, args, options) {
    const { signal, timeoutMs, killGraceMs = DEFAULT_KILL_GRACE_MS } = options

    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let settled = false
      let cancelled = false
      const timers = []

      function finish(result) {
        if (settled) {
          return
        }
        settled = true
        timers.forEach(clearTimeout)
        signal?.removeEventListener('abort', onAbort)
        resolve(result)
      }

      const cancelledResult = () => ({
        command,
        args,
        exitCode: CANCELLED_EXIT_CODE,
        stdout,
        stderr,
        failed: true,
        cancelled: true
      })

      function onAbort() {
        if (settled || cancelled) {
          return
        }
        cancelled = true
        killProcessTree(child, killGraceMs)
        // `close` normally settles us once the tree is dead; this is the
        // failsafe for a kill that never lands (e.g. taskkill failing).
        timers.push(setTimeout(() => finish(cancelledResult()), killGraceMs + 1000))
      }

      if (signal?.aborted) {
        finish(cancelledResult())
        return
      }

      const child = spawn(command, args, {
        cwd: options.cwd,
        env: this.#envWithSshPassword({ ...process.env, ...(options.env ?? {}) }),
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: options.shell ?? false,
        // POSIX: lead our own process group so cancel/timeout can signal the whole tree.
        detached: process.platform !== 'win32'
      })

      signal?.addEventListener('abort', onAbort, { once: true })

      // Opt-in: clone/get/push legitimately run for minutes, so only probes
      // that must return promptly pass timeoutMs.
      if (timeoutMs) {
        timers.push(
          setTimeout(() => {
            killProcessTree(child, killGraceMs)
            finish({
              command,
              args,
              exitCode: 124,
              stdout,
              stderr: `${stderr}\n${command} timed out after ${timeoutMs}ms`.trim(),
              failed: true
            })
          }, timeoutMs)
        )
      }

      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
      })

      child.stderr.on('data', (chunk) => {
        stderr += String(chunk)
      })

      child.on('error', (error) => {
        finish({
          command,
          args,
          exitCode: 127,
          stdout,
          stderr: stderr || String(error.message),
          failed: true,
          error
        })
      })

      child.on('close', (exitCode) => {
        if (cancelled) {
          finish(cancelledResult())
          return
        }
        finish({
          command,
          args,
          exitCode: exitCode ?? 1,
          stdout,
          stderr,
          failed: (exitCode ?? 1) !== 0
        })
      })
    })
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/process-runner.test.js`
Expected: all pass (including the existing timeout/lock-retry tests). Then `npm test` for the whole suite: expected all pass.

- [ ] **Step 6: Checkpoint**

Suggested commit: `feat: abortable ProcessRunner that kills the whole process tree`

---

### Task 2: Live output lines from ProcessRunner

**Files:**
- Modify: `src/datalad/process-runner.js` (data handlers)
- Test: `test/process-runner.test.js` (append)

**Interfaces:**
- Consumes: Task 1 `#runOnce`.
- Produces: `options.onOutput(line: string)` called once per stdout/stderr chunk with the latest non-empty line of that chunk (split on `\r` and `\n`, trimmed).

- [ ] **Step 1: Write the failing tests**

Append to `test/process-runner.test.js`:

```js
test('ProcessRunner reports the latest line of each output chunk via onOutput', async () => {
  const lines = []
  const script =
    "process.stdout.write('first line\\n');" +
    "setTimeout(() => process.stdout.write('10%\\r50%\\r75%\\r'), 80);" +
    "setTimeout(() => process.stderr.write('warning: something\\n'), 160)"
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/process-runner.test.js`
Expected: the two new tests FAIL (`lines` is `[]` because `onOutput` is never called).

- [ ] **Step 3: Implement**

In `src/datalad/process-runner.js`, add above the class:

```js
// Progress bars redraw with \r, so split on both; only the latest visible line
// of a chunk matters for the activity display. A line split across two chunks
// is shown as two partial lines - acceptable for a status hint.
function latestLine(chunk) {
  return String(chunk)
    .split(/[\r\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1)
}
```

In `#runOnce`, change the destructuring to include `onOutput` and replace the two data handlers:

```js
    const { signal, timeoutMs, killGraceMs = DEFAULT_KILL_GRACE_MS, onOutput } = options
```

```js
      const report = (chunk) => {
        const line = onOutput ? latestLine(chunk) : undefined
        if (line) {
          onOutput(line)
        }
      }

      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
        report(chunk)
      })

      child.stderr.on('data', (chunk) => {
        stderr += String(chunk)
        report(chunk)
      })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/process-runner.test.js` then `npm test`. Expected: all pass.

- [ ] **Step 5: Checkpoint**

Suggested commit: `feat: ProcessRunner onOutput reports the latest output line`

---

### Task 3: CANCELLED error mapping and adapter pass-through

**Files:**
- Modify: `src/datalad/errors.js` (top of `mapCommandError`)
- Modify: `src/datalad/adapter.js` (`runCommand`)
- Test: `test/errors.test.js`, `test/adapter.test.js` (append to each)

**Interfaces:**
- Consumes: Task 1/2 runner result (`cancelled: true`) and options (`signal`, `onOutput`).
- Produces: `mapCommandError(name, result)` returns `{ code: 'CANCELLED', title, message, technicalDetails }` for a cancelled result; `DataLadAdapter#runCommand(commandName, request = {}, runOptions = {})` where `runOptions` is `{ signal?, onOutput? }`.

- [ ] **Step 1: Write the failing tests**

Append to `test/errors.test.js`:

```js
test('mapCommandError maps a cancelled run to a calm CANCELLED result for any command', () => {
  for (const commandName of ['save', 'cloneInstall', 'get', 'push']) {
    const result = mapCommandError(commandName, { cancelled: true, failed: true, stderr: 'fatal: Unable to create index.lock' })
    assert.equal(result.code, 'CANCELLED')
    assert.match(result.message, /Stopped by you/)
  }
})
```

Append to `test/adapter.test.js` (uses the existing `FakeRunner`):

```js
test('runCommand hands signal and onOutput to the runner and maps a cancelled run to CANCELLED', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['-C', '/tmp/project', 'save', '--message=checkpoint'], {
    exitCode: 130,
    failed: true,
    cancelled: true
  })
  const signal = new AbortController().signal
  const onOutput = () => {}

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand(
    'save',
    { projectPath: '/tmp/project', message: 'checkpoint' },
    { signal, onOutput }
  )

  assert.equal(runner.calls[0].options.signal, signal)
  assert.equal(runner.calls[0].options.onOutput, onOutput)
  assert.equal(result.ok, false)
  assert.equal(result.cancelled, true)
  assert.equal(result.userError.code, 'CANCELLED')
})

test('runCommand still works when no runOptions are given', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['-C', '/tmp/project', 'save', '--message=checkpoint'], { stdout: 'ok\n' })

  const result = await new DataLadAdapter({ runner }).runCommand('save', {
    projectPath: '/tmp/project',
    message: 'checkpoint'
  })

  assert.equal(result.ok, true)
  assert.equal(runner.calls[0].options.signal, undefined)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/errors.test.js test/adapter.test.js`
Expected: the CANCELLED test FAILs (`code` is something else / undefined) and the adapter pass-through test FAILs (`options.signal` is `undefined`).

- [ ] **Step 3: Implement**

In `src/datalad/errors.js`, insert as the first statement of `mapCommandError` (right after `const details = stderr.trim()` is fine, but it must run before any pattern branch):

```js
  if (runResult.cancelled) {
    return {
      code: 'CANCELLED',
      title: 'Stopped',
      message: 'Stopped by you. Nothing was rolled back - check the project status before continuing.',
      technicalDetails: ''
    }
  }
```

In `src/datalad/adapter.js`, change `runCommand`:

```js
  async runCommand(commandName, request = {}, runOptions = {}) {
    if (!CURATED_COMMANDS.has(commandName)) {
      throw new Error(`Unsupported command: ${commandName}`)
    }

    assertCommandRequest(commandName, request)

    const commandSpec = this.#buildCommand(commandName, request)
    let result = await this.runner.run(commandSpec.command, commandSpec.args, {
      ...commandSpec.options,
      signal: runOptions.signal,
      onOutput: runOptions.onOutput
    })
```

(leave the rest of the method unchanged).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/errors.test.js test/adapter.test.js test/adapter-parity.test.js` then `npm test`. Expected: all pass (parity test must stay green: the result shape only gains an optional `cancelled`).

- [ ] **Step 5: Checkpoint**

Suggested commit: `feat: adapter passes cancel signal and output callback, maps CANCELLED`

---

### Task 4: Run registry and activity throttle (Electron-free module)

**Files:**
- Create: `src/gui/run-registry.js`
- Test: `test/run-registry.test.js`

**Interfaces:**
- Produces: `createRunRegistry()` returning `{ register(runId): AbortSignal, cancel(runId): boolean, finish(runId): void, abortAll(): void, size(): number }`; `register` throws on an invalid or duplicate id (valid: string matching `/^[\w-]{1,80}$/`).
- Produces: `createLatestLineThrottle(send: (line) => void, intervalMs = 250)` returning `{ push(line), stop() }` (leading send, trailing send of the newest line, `stop` drops anything pending).

- [ ] **Step 1: Write the failing tests**

Create `test/run-registry.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRunRegistry, createLatestLineThrottle } from '../src/gui/run-registry.js'

test('register returns a live signal and cancel aborts it exactly once', () => {
  const registry = createRunRegistry()
  const signal = registry.register('run-1')

  assert.equal(signal.aborted, false)
  assert.equal(registry.cancel('run-1'), true)
  assert.equal(signal.aborted, true)
  assert.equal(registry.cancel('run-1'), false, 'a second cancel is a no-op')
})

// Review focus 1: a cancel click that races completion must be a silent false.
test('cancel on a finished or unknown run returns false instead of throwing', () => {
  const registry = createRunRegistry()
  registry.register('run-1')
  registry.finish('run-1')

  assert.equal(registry.cancel('run-1'), false)
  assert.equal(registry.cancel('never-existed'), false)
  assert.equal(registry.size(), 0)
})

// Review focus 3: ids come from the renderer, which main does not fully trust.
test('register rejects invalid and duplicate run ids without registering them', () => {
  const registry = createRunRegistry()
  for (const bad of [undefined, null, 42, '', 'a b', '../x', 'x'.repeat(81), {}]) {
    assert.throws(() => registry.register(bad), /runId/)
  }
  registry.register('dup')
  assert.throws(() => registry.register('dup'), /already active/)
  assert.equal(registry.size(), 1)
})

// Review focus 5: quitting mid-command must not orphan child processes.
test('abortAll aborts every active run', () => {
  const registry = createRunRegistry()
  const signals = ['a', 'b', 'c'].map((id) => registry.register(id))
  registry.abortAll()

  assert.ok(signals.every((signal) => signal.aborted))
})

test('throttle sends the first line at once, then only the newest line per interval', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const sent = []
  const throttle = createLatestLineThrottle((line) => sent.push(line), 250)

  throttle.push('a')
  throttle.push('b')
  throttle.push('c')
  assert.deepEqual(sent, ['a'])

  t.mock.timers.tick(250)
  assert.deepEqual(sent, ['a', 'c'])

  t.mock.timers.tick(250)
  throttle.push('d')
  assert.deepEqual(sent, ['a', 'c', 'd'])
})

test('throttle stop drops the pending line and cancels the timer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const sent = []
  const throttle = createLatestLineThrottle((line) => sent.push(line), 250)

  throttle.push('a')
  throttle.push('b')
  throttle.stop()
  t.mock.timers.tick(1000)

  assert.deepEqual(sent, ['a'])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/run-registry.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `run-registry.js`.

- [ ] **Step 3: Implement `src/gui/run-registry.js`**

```js
// Electron-free bookkeeping for cancellable runs, kept out of main.js so it is
// unit-testable. Run ids come from the renderer, so they are validated.
const RUN_ID_PATTERN = /^[\w-]{1,80}$/

export function createRunRegistry() {
  const runs = new Map()

  return {
    register(runId) {
      if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) {
        throw new Error('Invalid runId')
      }
      if (runs.has(runId)) {
        throw new Error(`runId already active: ${runId}`)
      }
      const controller = new AbortController()
      runs.set(runId, controller)
      return controller.signal
    },

    // false when the run is unknown, finished or already cancelled, so a cancel
    // click that races completion is harmless.
    cancel(runId) {
      const controller = runs.get(runId)
      if (!controller || controller.signal.aborted) {
        return false
      }
      controller.abort()
      return true
    },

    finish(runId) {
      runs.delete(runId)
    },

    abortAll() {
      for (const controller of runs.values()) {
        controller.abort()
      }
    },

    size() {
      return runs.size
    }
  }
}

// Sends the first line immediately, then at most one (the newest) per interval.
// stop() drops anything pending so nothing is sent after the run finished.
export function createLatestLineThrottle(send, intervalMs = 250) {
  let lastSentAt = -Infinity
  let pending = null
  let timer = null

  const emit = (line) => {
    lastSentAt = Date.now()
    send(line)
  }

  return {
    push(line) {
      const wait = lastSentAt + intervalMs - Date.now()
      if (wait <= 0 && timer === null) {
        emit(line)
        return
      }
      pending = line
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null
          const latest = pending
          pending = null
          if (latest !== null) {
            emit(latest)
          }
        }, Math.max(wait, 0))
      }
    },

    stop() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      pending = null
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/run-registry.test.js` then `npm test`. Expected: all pass.

- [ ] **Step 5: Checkpoint**

Suggested commit: `feat: run registry and activity throttle for cancellable commands`

---

### Task 5: Main process and preload wiring (proved by an API-level e2e)

**Files:**
- Modify: `src/gui/main.js` (imports, registry, `adapter:runCommand`, `console:runCommand`, new `adapter:cancelCommand`, `before-quit`)
- Modify: `src/gui/preload.js`
- Create: `e2e/cancel.e2e.mjs`

**Interfaces:**
- Consumes: Task 3 `adapter.runCommand(name, request, { signal, onOutput })`; Task 4 `createRunRegistry`, `createLatestLineThrottle`; Task 1/2 runner options for `consoleRunner.run`.
- Produces (renderer-facing, on `window.dataladDesktop`): `runCommand(commandName, request, runId?)`, `cancelCommand(runId): Promise<boolean>`, `onCommandActivity(cb): () => void` where `cb({ runId, line })`; `runConsoleCommand({ commandText, projectPath, runId? })`.

- [ ] **Step 1: Write the failing e2e**

Create `e2e/cancel.e2e.mjs`:

```js
// Real-Electron proof that cancelling works end to end over IPC: a running
// console command is stopped, its process is really gone, and its output is
// streamed as activity events. The UI strip is covered in the same file below
// once the renderer is wired (see the last test).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'
import { createTempRoot, createPlainGitRepo } from './fixtures.mjs'

let app
let root
let projectPath

test.before(async () => {
  root = await createTempRoot()
  app = await launchApp()
  projectPath = await createPlainGitRepo(root)
  await app.openProject(projectPath)
  await app.page.evaluate(() => window.dataladDesktop.setConsoleEnabled(true))
})

test.after(async () => {
  await app?.close()
})

async function waitFor(check, { timeoutMs = 15_000, intervalMs = 50 } = {}) {
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

// Records its own pid (so the test can prove it is really gone), prints a line
// (for the activity stream), then idles. No `=>` or `>`: on Windows the console
// line goes through cmd.exe.
function slowCommand(pidFile) {
  return (
    `node -e "require('fs').writeFileSync(process.argv[1], String(process.pid)); ` +
    `console.log('working 1'); setInterval(function () {}, 1000)" "${pidFile}"`
  )
}

function runConsole(commandText, runId) {
  return app.page.evaluate(
    (args) => window.dataladDesktop.runConsoleCommand(args),
    { commandText, projectPath, runId }
  )
}

test('cancelCommand stops a running console command and its process', async () => {
  const pidFile = join(root, 'cancel-pid.txt')
  const runId = 'e2e-cancel-1'
  const running = runConsole(slowCommand(pidFile), runId)

  const pid = Number(await waitFor(() => readIfExists(pidFile)))
  assert.equal(await app.page.evaluate((id) => window.dataladDesktop.cancelCommand(id), runId), true)

  const result = await running
  assert.equal(result.cancelled, true)
  assert.equal(result.failed, true)
  await waitFor(() => !isAlive(pid))

  // The run is finished, so a second cancel (a click racing completion) is a harmless false.
  assert.equal(await app.page.evaluate((id) => window.dataladDesktop.cancelCommand(id), runId), false)
})

test('output of a running command is streamed as activity events for its runId', async () => {
  const pidFile = join(root, 'activity-pid.txt')
  const runId = 'e2e-activity-1'
  await app.page.evaluate(() => {
    window.__activity = []
    window.dataladDesktop.onCommandActivity((event) => window.__activity.push(event))
  })
  const running = runConsole(slowCommand(pidFile), runId)

  await app.page.waitForFunction(
    (id) => window.__activity.some((e) => e.runId === id && e.line === 'working 1'),
    runId,
    { timeout: 15_000 }
  )

  await app.page.evaluate((id) => window.dataladDesktop.cancelCommand(id), runId)
  await running
})
```

- [ ] **Step 2: Run the e2e to verify it fails**

Run: `env -u ELECTRON_RUN_AS_NODE node --test e2e/cancel.e2e.mjs`
Expected: FAIL in the first test (`window.dataladDesktop.cancelCommand is not a function`, and the console command is still running - kill it with `pkill -f "console.log('working 1')"` if it lingers).

- [ ] **Step 3: Implement `src/gui/preload.js`**

Replace the `runCommand` entry and add the two new entries (keep everything else):

```js
  runCommand: (commandName, request, runId) =>
    ipcRenderer.invoke('adapter:runCommand', {
      commandName,
      request,
      runId
    }),
  cancelCommand: (runId) => ipcRenderer.invoke('adapter:cancelCommand', runId),
  onCommandActivity: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('command:activity', listener)
    return () => ipcRenderer.removeListener('command:activity', listener)
  },
```

(`runConsoleCommand: (payload) => ...` already forwards the whole payload, so `runId` passes through unchanged.)

- [ ] **Step 4: Implement `src/gui/main.js`**

Add the import next to the other local imports:

```js
import { createLatestLineThrottle, createRunRegistry } from './run-registry.js'
```

Add below `const consoleRunner = new ProcessRunner()`:

```js
const runRegistry = createRunRegistry()

// Runs `run({ signal, onOutput })` as a cancellable, observable run when the
// renderer supplied a runId; otherwise runs it plain, as before.
async function runWithHandle(event, runId, run) {
  if (runId === undefined) {
    return run({})
  }

  const signal = runRegistry.register(runId)
  const activity = createLatestLineThrottle((line) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('command:activity', { runId, line })
    }
  })
  try {
    return await run({ signal, onOutput: activity.push })
  } finally {
    activity.stop()
    runRegistry.finish(runId)
  }
}
```

Replace the `adapter:runCommand` handler:

```js
ipcMain.handle('adapter:runCommand', async (event, payload) => {
  const result = await runWithHandle(event, payload.runId, (runOptions) =>
    adapter.runCommand(payload.commandName, payload.request, runOptions)
  )
  if (
    result?.ok &&
    (payload.commandName === 'cloneInstall' || payload.commandName === 'createProject')
  ) {
    authorizeRoot(payload.request?.targetPath)
  }
  return result
})

ipcMain.handle('adapter:cancelCommand', (_event, runId) => {
  return typeof runId === 'string' ? runRegistry.cancel(runId) : false
})
```

Replace the tail of the `console:runCommand` handler (`const commandSpec = ...` and the `return`) with:

```js
  const commandSpec = buildConsoleCommand(payload)
  return runWithHandle(event, payload.runId, (runOptions) =>
    consoleRunner.run(commandSpec.command, commandSpec.args, { ...commandSpec.options, ...runOptions })
  )
```

and change that handler's signature from `async (_event, payload = {})` to `async (event, payload = {})`.

In the `before-quit` handler, add as the first statement:

```js
  runRegistry.abortAll()
```

- [ ] **Step 5: Run the e2e and the unit suite to verify they pass**

Run: `env -u ELECTRON_RUN_AS_NODE node --test e2e/cancel.e2e.mjs` then `npm test`.
Expected: both e2e tests pass; unit suite passes. Also run the whole e2e suite once: `env -u ELECTRON_RUN_AS_NODE npm run test:e2e` (path-confinement and busy-state e2e must stay green).

- [ ] **Step 6: Checkpoint**

Suggested commit: `feat: cancelCommand IPC, run registry wiring and command:activity events`

---

### Task 6: Renderer helpers (activity formatting, row rendering, run ids, sequence stop)

**Files:**
- Create: `src/gui/renderer/run-activity.js`
- Test: `test/run-activity.test.js`

**Interfaces:**
- Produces: `createRunId(): string` (matches `/^[\w-]{1,80}$/`, unique per call); `formatActivityLine(line, max = 120): string`; `renderRunningRows(runs: Array<{ runId, label, line, stopping }>): string` (HTML, all text escaped); `shouldStopSequence(result): boolean` (true when `result?.cancelled` or `result?.userError?.code === 'CANCELLED'`).

- [ ] **Step 1: Write the failing tests**

Create `test/run-activity.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createRunId,
  formatActivityLine,
  renderRunningRows,
  shouldStopSequence
} from '../src/gui/renderer/run-activity.js'

test('createRunId yields distinct ids the main process accepts', () => {
  const ids = new Set(Array.from({ length: 50 }, () => createRunId()))
  assert.equal(ids.size, 50)
  for (const id of ids) {
    assert.match(id, /^[\w-]{1,80}$/)
  }
})

test('formatActivityLine strips terminal escapes, collapses whitespace and truncates', () => {
  assert.equal(formatActivityLine('\u001b[32mget(ok)\u001b[0m:   sub-01/T1w.nii.gz  '), 'get(ok): sub-01/T1w.nii.gz')
  assert.equal(formatActivityLine(undefined), '')
  const long = formatActivityLine('x'.repeat(500), 40)
  assert.equal(long.length, 40)
  assert.ok(long.endsWith('…'))
})

// Review focus 2: process output is untrusted, it must never become markup.
test('renderRunningRows escapes labels and activity text', () => {
  const html = renderRunningRows([
    { runId: 'r1', label: '<img src=x onerror=alert(1)>', line: '<script>alert(2)</script> & "quoted"', stopping: false }
  ])

  assert.doesNotMatch(html, /<img|<script/)
  assert.match(html, /&lt;script&gt;alert\(2\)&lt;\/script&gt; &amp; &quot;quoted&quot;/)
})

test('renderRunningRows offers a named Cancel button, or a disabled Stopping state', () => {
  const [active, stopping] = [
    renderRunningRows([{ runId: 'run-1', label: 'Save', line: 'adding', stopping: false }]),
    renderRunningRows([{ runId: 'run-1', label: 'Save', line: 'adding', stopping: true }])
  ]

  assert.match(active, /data-cancel-run="run-1"/)
  assert.match(active, /aria-label="Cancel Save"/)
  assert.doesNotMatch(stopping, /data-cancel-run/)
  assert.match(stopping, /disabled>Stopping…/)
  assert.equal(renderRunningRows([]), '')
})

// Review focus 4: a cancelled step must end a multi-step sequence.
test('shouldStopSequence is true only for a cancelled result', () => {
  assert.equal(shouldStopSequence({ ok: false, cancelled: true }), true)
  assert.equal(shouldStopSequence({ ok: false, userError: { code: 'CANCELLED' } }), true)
  assert.equal(shouldStopSequence({ ok: false, userError: { code: 'REPO_LOCKED' } }), false)
  assert.equal(shouldStopSequence({ ok: true }), false)
  assert.equal(shouldStopSequence(null), false)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/run-activity.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `run-activity.js`.

- [ ] **Step 3: Implement `src/gui/renderer/run-activity.js`**

```js
// Pure helpers for the "running commands" strip, kept out of app.js so they are
// unit-testable (same idea as save-gating.js).
const ANSI_ESCAPE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

export function createRunId() {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function formatActivityLine(line, max = 120) {
  const clean = String(line ?? '').replace(ANSI_ESCAPE, '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

// The activity line is process output (untrusted): always escape.
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function renderRunningRows(runs) {
  return runs
    .map((run) => {
      const id = escapeHtml(run.runId)
      const label = escapeHtml(run.label)
      const button = run.stopping
        ? '<button type="button" class="button button-ghost button-inline" disabled>Stopping…</button>'
        : `<button type="button" class="button button-ghost button-inline" data-cancel-run="${id}" aria-label="Cancel ${label}">Cancel</button>`
      return (
        `<div class="running-row" data-run-row="${id}">` +
        `<span class="running-label">${label}…</span>` +
        `<span class="running-line" aria-live="off">${escapeHtml(run.line)}</span>` +
        button +
        '</div>'
      )
    })
    .join('')
}

// Multi-step flows (BIDS nesting) must stop at the first cancelled step.
export function shouldStopSequence(result) {
  return Boolean(result?.cancelled) || result?.userError?.code === 'CANCELLED'
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/run-activity.test.js` then `npm test`. Expected: all pass.

- [ ] **Step 5: Checkpoint**

Suggested commit: `feat: renderer helpers for the running-commands strip`

---

### Task 7: Renderer UI - running strip, Cancel, post-cancel state, sequence stop, console

**Files:**
- Modify: `src/gui/renderer/index.html` (new section)
- Modify: `src/gui/renderer/styles.css` (append)
- Modify: `src/gui/renderer/app.js` (import, state, element, strip functions, `runWorkflowCommand`, `buildWorkflowStatusLine`, `renderCommandResult`, `nestBidsCandidates`, `detectAndMaybeNestBids`, `runConsoleCommand`, `renderConsoleResult`)
- Test: `e2e/cancel.e2e.mjs` (append)

**Interfaces:**
- Consumes: Task 5 `api.runCommand(name, request, runId)`, `api.cancelCommand(runId)`, `api.onCommandActivity(cb)`, `api.runConsoleCommand({..., runId})`; Task 6 helpers.
- Produces: DOM `#running-commands` (hidden when no runs) containing `.running-row[data-run-row]` with `.running-line` and a `[data-cancel-run]` button.

- [ ] **Step 1: Write the failing UI e2e**

Append to `e2e/cancel.e2e.mjs`:

```js
test('the running strip shows live output and Cancel stops the command', async () => {
  const pidFile = join(root, 'ui-pid.txt')
  await app.page.evaluate(
    (commandText) => {
      const input = document.getElementById('console-command')
      input.value = commandText
      input.dispatchEvent(new Event('input', { bubbles: true }))
      document.getElementById('console-run').click()
    },
    slowCommand(pidFile)
  )

  const pid = Number(await waitFor(() => readIfExists(pidFile)))

  await app.page.waitForFunction(
    () => document.querySelector('#running-commands .running-line')?.textContent === 'working 1',
    undefined,
    { timeout: 15_000 }
  )
  assert.equal(await app.page.evaluate(() => document.getElementById('running-commands').hidden), false)

  await app.page.evaluate(() => document.querySelector('#running-commands [data-cancel-run]').click())

  await app.page.waitForFunction(() => document.getElementById('running-commands').hidden, undefined, {
    timeout: 15_000
  })
  await waitFor(() => !isAlive(pid))
  const output = await app.page.evaluate(() => document.getElementById('console-output').textContent)
  assert.match(output, /Stopped by you/)
})
```

- [ ] **Step 2: Run the e2e to verify it fails**

Run: `env -u ELECTRON_RUN_AS_NODE node --test e2e/cancel.e2e.mjs`
Expected: the new test FAILs with a `waitForFunction` timeout (there is no `#running-commands` element yet, so the text never matches). Kill any lingering `node -e ... working 1` process. The two Task 5 tests still pass.

- [ ] **Step 3: Add the strip to `src/gui/renderer/index.html`**

Insert immediately before `<section id="project-health-card" ...>`:

```html
      <section id="running-commands" class="card running-commands" role="status" aria-label="Running commands" hidden></section>
```

- [ ] **Step 4: Append to `src/gui/renderer/styles.css`**

```css
.running-commands {
  display: grid;
  gap: 0.4rem;
  padding: 0.6rem 0.9rem;
}

.running-commands[hidden] {
  display: none;
}

.running-row {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
}

.running-label {
  font-weight: 600;
  white-space: nowrap;
}

.running-line {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink-soft);
  font-family: var(--mono);
  font-size: 0.82rem;
}

.result-status-warning .result-status-marker {
  background: #f5e8cf;
  border: 1px solid rgba(131, 89, 36, 0.36);
  color: #835924;
}
```

- [ ] **Step 5: Wire `src/gui/renderer/app.js`**

a) Add to the imports at the top:

```js
import { createRunId, formatActivityLine, renderRunningRows, shouldStopSequence } from './run-activity.js'
```

b) Add to the `state` object (next to `pendingCommands: new Set(),`):

```js
  activeRuns: new Map(),
```

c) Add to `elements` (next to `consoleOutput`):

```js
  runningCommands: document.getElementById('running-commands'),
```

d) Add these functions (for example right above `async function runWorkflowCommand`) and the listeners below them:

```js
function renderRunningCommands() {
  const runs = [...state.activeRuns.values()]
  elements.runningCommands.hidden = runs.length === 0
  elements.runningCommands.innerHTML = renderRunningRows(runs)
}

function trackRun(runId, label) {
  state.activeRuns.set(runId, { runId, label, line: '', stopping: false })
  renderRunningCommands()
}

function untrackRun(runId) {
  state.activeRuns.delete(runId)
  renderRunningCommands()
}

// Activity arrives several times a second: update just the text node so the
// Cancel button keeps focus instead of being re-rendered under the user.
api.onCommandActivity(({ runId, line }) => {
  const run = state.activeRuns.get(runId)
  if (!run) {
    return
  }
  run.line = formatActivityLine(line)
  const span = elements.runningCommands.querySelector(`[data-run-row="${CSS.escape(runId)}"] .running-line`)
  if (span) {
    span.textContent = run.line
  }
})

elements.runningCommands.addEventListener('click', (event) => {
  const button = event.target.closest('[data-cancel-run]')
  const run = button && state.activeRuns.get(button.dataset.cancelRun)
  if (!run || run.stopping) {
    return
  }
  run.stopping = true
  renderRunningCommands()
  void api.cancelCommand(run.runId)
})
```

e) In `runWorkflowCommand`: directly after `state.pendingCommands.add(commandName)` add

```js
  const runId = createRunId()
  trackRun(runId, actionLabel(commandName))
```

change `const result = await api.runCommand(commandName, request)` to

```js
    const result = await api.runCommand(commandName, request, runId)
```

In the `finally` block, add `untrackRun(runId)` as the first statement (before `state.pendingCommands.delete(commandName)`).

In the same function, change the result handling so a cancel refreshes state and uses the warning tone. Replace

```js
    if (!result.ok && nextProjectPath && !skipBackgroundRefresh) {
      void refreshWorkingTreeStatus(nextProjectPath)
    }
```

with

```js
    if (!result.ok && nextProjectPath && !skipBackgroundRefresh) {
      void refreshWorkingTreeStatus(nextProjectPath)
      if (result.cancelled) {
        void refreshProjectHealth(nextProjectPath)
      }
    }
```

and replace

```js
    } else {
      setLastActionState(`${actionLabel(commandName)} failed.`, 'error')
    }

    return result
```

with

```js
    } else if (result.cancelled) {
      setLastActionState('Stopped.', 'warning')
    } else {
      setLastActionState(`${actionLabel(commandName)} failed.`, 'error')
    }

    return result
```

f) In `buildWorkflowStatusLine`, add as the first statement:

```js
  if (result.cancelled) {
    return 'Stopped by you. Nothing was rolled back - check the project status before continuing.'
  }
```

In `renderCommandResult`, replace the three tone constants with cancelled-aware ones:

```js
  const statusToneClass = result.cancelled ? 'result-status-warning' : result.ok ? 'result-status-ok' : 'result-status-error'
  const statusMarker = result.cancelled ? '!' : result.ok ? 'OK' : 'X'
  const statusMarkerLabel = result.cancelled ? 'Stopped' : result.ok ? 'Success' : 'Error'
```

g) BIDS nesting stops at the first cancelled step. In `nestBidsCandidates`, after `steps.push({ label: \`Create subdataset: ${candidatePath}\`, result: createResult })` add

```js
      if (shouldStopSequence(createResult)) {
        cancelled = true
        break
      }
```

after `steps.push({ label: \`Save subdataset content: ${candidatePath}\`, result: saveResult })` add

```js
      if (shouldStopSequence(saveResult)) {
        cancelled = true
        break
      }
```

declare `let cancelled = false` next to `const steps = []` at the top of the function, and immediately after `onProgress?.(total, total, null)` add

```js
  if (cancelled) {
    return { steps, succeeded, cancelled: true }
  }
```

In `detectAndMaybeNestBids`, change `const { steps, succeeded } = nested` to `const { steps, succeeded, cancelled } = nested` and, directly after the `setLastActionState(\`Nested ...\`)` line, add

```js
  if (cancelled) {
    setLastActionState('Stopped.', 'warning')
  }
```

(the subsequent re-detect and refresh still run, so the project view is current; only the remaining folders and the parent save are skipped).

h) Console: in `runConsoleCommand`, after `elements.consoleOutput.textContent = \`$ ${commandText}\n\nRunning...\`` add

```js
  const runId = createRunId()
  trackRun(runId, 'Console')
```

change the call to `await api.runConsoleCommand({ commandText, projectPath, runId })`, and add `untrackRun(runId)` as the first statement of its `finally` block. In `renderConsoleResult`, replace the `statusLine` constant with

```js
  const statusLine = result.cancelled
    ? 'Stopped by you'
    : result.failed
      ? `Failed (exit ${result.exitCode})`
      : `Succeeded (exit ${result.exitCode})`
```

- [ ] **Step 6: Run the e2e and all tests to verify they pass**

Run: `env -u ELECTRON_RUN_AS_NODE node --test e2e/cancel.e2e.mjs` (all three tests pass), then `env -u ELECTRON_RUN_AS_NODE npm run test:e2e` and `npm test`. Expected: everything green. Manually sanity-check once in the real app (`npm start`): open a project, run a slow console command, see the strip row and live line, click Cancel.

- [ ] **Step 7: Checkpoint**

Suggested commit: `feat: running-commands strip with Cancel and live activity line`

---

### Task 8: Docs, status and full verification

**Files:**
- Modify: `docs/roadmap.md` (Phase 3 bullet)
- Modify: `docs/superpowers/specs/2026-09-30-command-cancellation-design.md` (status)

- [ ] **Step 1: Update the roadmap**

In `docs/roadmap.md`, replace the Phase 3 bullet

`- Add cancellation and progress reporting for long-running DataLad actions.`

with

`- Cancellation and a live activity line (latest output line) for long-running actions and the console are implemented (see docs/superpowers/specs/2026-09-30-command-cancellation-design.md). Parsed progress bars (percent/bytes) remain open.`

- [ ] **Step 2: Mark the spec implemented**

In the spec front matter change `status: approved` to `status: implemented`.

- [ ] **Step 3: Full verification**

Run, in order, and read the output:
1. `npm test` - expected: all pass, 0 fail.
2. `env -u ELECTRON_RUN_AS_NODE npm run test:e2e` - expected: all pass, 0 fail (packaged/installer specs skip without `DLAD_APP_EXECUTABLE`).
3. `npm run package:dir` then `DLAD_APP_EXECUTABLE="dist/mac-arm64/DataLad Desktop.app/Contents/MacOS/DataLad Desktop" env -u ELECTRON_RUN_AS_NODE node --test e2e/packaged.e2e.mjs` - expected: pass (proves the new files ship in the asar).

- [ ] **Step 4: CI**

After the maintainer pushes: the Windows smoke job runs `e2e/cancel.e2e.mjs`, which is the only proof of the Windows `taskkill` path. If it fails on Windows, read the e2e step log itself (`gh run view --job <id> --log`), not the API step conclusions.

- [ ] **Step 5: Checkpoint**

Suggested commit: `docs: mark command cancellation implemented`

---

## Self-review

**Spec coverage:** runner tree-kill/signal/timeout/`onOutput`/no-retry/kill-failure failsafe (Tasks 1-2); adapter pass-through and CANCELLED mapping (Task 3); registry, validation, cancel race, abortAll, throttle (Task 4); IPC, `before-quit`, preload, console included (Task 5); activity-line/row/escaping/sequence helpers (Task 6); strip, Cancel, a11y, post-cancel UX and refresh, nesting stop, console (Task 7); roadmap and verification (Task 8). The Windows `taskkill` path is covered by the e2e in CI only, as the spec's open risks say.

**Placeholders:** none; every code step has full code.

**Type consistency:** `createRunRegistry` (`register/cancel/finish/abortAll/size`), `createLatestLineThrottle` (`push/stop`), `runWithHandle(event, runId, run)`, `runOptions { signal, onOutput }`, `killProcessTree(child, graceMs)`, `createRunId/formatActivityLine/renderRunningRows/shouldStopSequence`, `data-cancel-run` / `data-run-row` / `.running-line` / `#running-commands` are used identically across tasks.

**Review Focus coverage:** items 1-5 each map to a named test (Task 4 cancel-race and validation and abortAll tests, Task 5 second-cancel assertion, Task 6 escaping and `shouldStopSequence` tests).
