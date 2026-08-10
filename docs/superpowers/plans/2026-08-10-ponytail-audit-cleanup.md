# Ponytail Audit Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the 4 findings from the `ponytail-audit` pass (2026-08-10): remove duplicated process-spawning logic, delete a no-op stub, and delete two pieces of dead single-implementation scaffolding.

**Architecture:** No architectural change. Each task is an isolated deletion or a swap of hand-rolled logic for an existing, already-imported utility (`ProcessRunner`). No new files, no new abstractions.

**Tech Stack:** Node.js (ESM, `node --test`), Electron main process.

## Global Constraints

- No new dependencies. Task 2 reuses `ProcessRunner`, which `src/gui/main.js` already imports and instantiates as `consoleRunner`.
- Zero intended behavior change. Every task is a dedup or dead-code removal identified by audit, not a feature change.
- Match existing code style: ES modules, no semicolons, 2-space indent (see any file under `src/` for reference).
- `npm test` (unit suite) must stay green after every task. `src/gui/main.js` itself has no unit tests (it imports Electron's `app`, which errors outside an Electron process) — Tasks 1 and 2 are verified with `node --check` plus `npm run test:e2e` and a manual smoke run instead.
- One commit per task.

---

### Task 1: Delete the dead `detectAnnexPresentSync` stub in main.js

**Files:**
- Modify: `src/gui/main.js:467-491` (the `annotatedEntries` map inside `listEntries`), `src/gui/main.js:547-552` (the function definition)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new. `entry.annexPresent` keeps the exact same possible values (`true`, `false`, `null`) for every input — `detectAnnexPresentSync` always returned `null`, and `annexPresent` is already initialized to `null` above the branch that calls it, so removing the branch changes no observable output.

- [ ] **Step 1: Confirm the stub is a no-op before touching anything**

Read `src/gui/main.js` and confirm:
```js
// Fallback when git-annex is unavailable for a repo.
// DataLad always requires git-annex, so this is only hit for plain git repos —
// those have no annex content to mark, so returning null is correct.
function detectAnnexPresentSync(_absolutePath) {
  return null
}
```
is the only body, and its only call site is inside the `else` branch below.

- [ ] **Step 2: Collapse the dead `else` branch**

In the `annotatedEntries = entries.map(...)` block, change:

```js
    if (annexInfo) {
      const relToRepo = relative(repoRoot, entry.absolutePath).split(sep).join('/')
      if (annexInfo.present.has(relToRepo)) {
        annexPresent = true
        presentRelPaths.add(entry.relativePath)
      } else if (annexInfo.absent.has(relToRepo)) {
        annexPresent = false
        absentRelPaths.add(entry.relativePath)
      }
    } else {
      // git annex not available: fall back to heuristic detection
      annexPresent = detectAnnexPresentSync(entry.absolutePath)
      if (annexPresent === true) presentRelPaths.add(entry.relativePath)
      else if (annexPresent === false) absentRelPaths.add(entry.relativePath)
    }
```

to:

```js
    if (annexInfo) {
      const relToRepo = relative(repoRoot, entry.absolutePath).split(sep).join('/')
      if (annexInfo.present.has(relToRepo)) {
        annexPresent = true
        presentRelPaths.add(entry.relativePath)
      } else if (annexInfo.absent.has(relToRepo)) {
        annexPresent = false
        absentRelPaths.add(entry.relativePath)
      }
    }
```

- [ ] **Step 3: Delete the now-unused function**

Remove entirely:

```js
// Fallback when git-annex is unavailable for a repo.
// DataLad always requires git-annex, so this is only hit for plain git repos —
// those have no annex content to mark, so returning null is correct.
function detectAnnexPresentSync(_absolutePath) {
  return null
}
```

- [ ] **Step 4: Verify no dangling references**

Run: `grep -n "detectAnnexPresentSync" src/gui/main.js`
Expected: no output.

- [ ] **Step 5: Syntax-check the file**

Run: `node --check src/gui/main.js`
Expected: no output (exit code 0).

- [ ] **Step 6: Commit**

```bash
git add src/gui/main.js
git commit -m "refactor: remove dead detectAnnexPresentSync stub"
```

---

### Task 2: Replace main.js's hand-rolled `runCommand` with the existing `ProcessRunner`

**Files:**
- Modify: `src/gui/main.js` (two call sites inside `listEntries`/`readGitStatusMap`, plus deletion of the local `runCommand` function at the end of the file)

**Interfaces:**
- Consumes: `consoleRunner` — already declared at `src/gui/main.js:18` as `const consoleRunner = new ProcessRunner()` — and its method `async run(command, args = [], options = {}) → { command, args, exitCode, stdout, stderr, failed, durationMs }` (`src/datalad/process-runner.js:60`).
- Produces: nothing new. `consoleRunner.run(...)` returns a superset of the fields the local `runCommand` returned (`stdout`, `stderr`, `failed`), so every existing caller keeps working unchanged. Callers also transparently gain `ProcessRunner`'s index-lock retry, which the local implementation lacked.

- [ ] **Step 1: Swap the two call sites**

In the `repoRoots` `Promise.all` block inside `listEntries`, change:

```js
      const [presResult, absResult] = await Promise.all([
        runCommand('git', ['-C', repoRoot, 'annex', 'find', '--in=here']),
        runCommand('git', ['-C', repoRoot, 'annex', 'find', '--not', '--in=here'])
      ])
```

to:

```js
      const [presResult, absResult] = await Promise.all([
        consoleRunner.run('git', ['-C', repoRoot, 'annex', 'find', '--in=here']),
        consoleRunner.run('git', ['-C', repoRoot, 'annex', 'find', '--not', '--in=here'])
      ])
```

In `readGitStatusMap`, change:

```js
async function readGitStatusMap(rootPath) {
  const gitResult = await runCommand('git', [
    '-C',
    rootPath,
    '-c',
    'core.quotePath=false',
    'status',
    '--porcelain',
    '--untracked-files=all'
  ])
```

to:

```js
async function readGitStatusMap(rootPath) {
  const gitResult = await consoleRunner.run('git', [
    '-C',
    rootPath,
    '-c',
    'core.quotePath=false',
    'status',
    '--porcelain',
    '--untracked-files=all'
  ])
```

- [ ] **Step 2: Delete the local `runCommand` implementation**

Remove entirely (the function immediately after `detectAnnexPresentSync`'s old location — after Task 1 this is the last function before `app.whenReady()`):

```js
async function runCommand(command, args) {
  return new Promise((resolveCommand) => {
    const processHandle = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    processHandle.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })

    processHandle.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    processHandle.on('error', () => {
      resolveCommand({
        stdout,
        stderr,
        failed: true
      })
    })

    processHandle.on('close', (exitCode) => {
      resolveCommand({
        stdout,
        stderr,
        failed: (exitCode ?? 1) !== 0
      })
    })
  })
}
```

- [ ] **Step 3: Drop the now-unused `spawn` import if nothing else in the file uses it**

Run: `grep -n "spawn(" src/gui/main.js`
If the only remaining match is inside `console:runCommand`'s use of `consoleRunner` (which doesn't call `spawn` directly — that's inside `ProcessRunner`), remove `spawn` from the top-of-file import:

```js
import { spawn } from 'node:child_process'
```

Only remove this line if the grep shows zero remaining call sites in `src/gui/main.js` — otherwise leave it.

- [ ] **Step 4: Verify no dangling references to the deleted function**

Run: `grep -n "\bfunction runCommand\b" src/gui/main.js`
Expected: no output. And confirm `grep -n "runCommand(" src/gui/main.js` now only shows `consoleRunner.run(` call sites (plus the unrelated `'adapter:runCommand'` IPC channel string, which is a different, pre-existing thing).

- [ ] **Step 5: Syntax-check the file**

Run: `node --check src/gui/main.js`
Expected: no output (exit code 0).

- [ ] **Step 6: Run the e2e suite as a smoke check**

Run: `npm run test:e2e`
Expected: all tests pass (this exercises the Electron main process end-to-end, so a broken `listEntries`/`readGitStatusMap` would surface as a failure even though no e2e test targets them directly).

- [ ] **Step 7: Manual smoke test**

Run: `npm start`, open a folder containing a DataLad dataset with at least one annexed file, and confirm the file browser still shows correct present/absent (annex) badges and git-status badges — this is the one path Step 6 doesn't directly cover.

- [ ] **Step 8: Commit**

```bash
git add src/gui/main.js
git commit -m "refactor: reuse ProcessRunner instead of a duplicate spawn wrapper in main.js"
```

---

### Task 3: Delete the unused `src/index.js` barrel file

**Files:**
- Delete: `src/index.js`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. This file re-exports `DataLadAdapter`, `createDataLadAdapter`, `ProcessRunner`, `formatEnvironmentDiagnostics`, `mapCommandError`, and the `schema.js` exports, but the package is `"private": true` with `"main": "src/gui/main.js"` (the Electron entry) — it is not published as a library and nothing in the repo imports from it.

- [ ] **Step 1: Confirm there are zero importers**

Run: `grep -rn "index\.js" --include="*.js" . | grep -v node_modules | grep -v "/target/" | grep -v "src/index.js:"`
Expected: no output referencing an import of `src/index.js` (any hits should only be unrelated files like `renderer/index.html` references, not JS imports of this module).

- [ ] **Step 2: Delete the file**

```bash
git rm src/index.js
```

- [ ] **Step 3: Run the unit suite**

Run: `npm test`
Expected: all tests pass (none import `src/index.js`, confirmed in Step 1).

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove unused src/index.js barrel file"
```

---

### Task 4: Delete the one-line `createDataLadAdapter` factory

**Files:**
- Modify: `src/datalad/adapter.js:1265-1267`
- Modify: `test/adapter.test.js:6` (import line), `test/adapter.test.js:1632-1637` (the test that only exercises the factory)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing new. `DataLadAdapter` (the class, still exported) is unaffected — this only removes the redundant one-line wrapper `createDataLadAdapter(options) { return new DataLadAdapter(options) }`, whose only real caller (after Task 3) is the test being edited here.

- [ ] **Step 1: Remove the factory from adapter.js**

At the end of `src/datalad/adapter.js`, remove:

```js
export function createDataLadAdapter(options) {
  return new DataLadAdapter(options)
}
```

- [ ] **Step 2: Update the test import**

In `test/adapter.test.js`, change:

```js
import { DataLadAdapter, createDataLadAdapter } from '../src/datalad/adapter.js'
```

to:

```js
import { DataLadAdapter } from '../src/datalad/adapter.js'
```

- [ ] **Step 3: Remove the factory-only test**

In `test/adapter.test.js`, remove:

```js
test('createDataLadAdapter builds a usable adapter instance', () => {
  const adapter = createDataLadAdapter({ runner: new FakeRunner() })

  assert.ok(adapter instanceof DataLadAdapter)
  assert.equal(adapter.getInterfaceContract().version, '0.5.0')
})
```

- [ ] **Step 4: Run the adapter test file**

Run: `node --test test/adapter.test.js`
Expected: all remaining tests pass; the output no longer lists a test named `createDataLadAdapter builds a usable adapter instance`.

- [ ] **Step 5: Run the full unit suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/datalad/adapter.js test/adapter.test.js
git commit -m "refactor: drop one-line createDataLadAdapter factory, construct DataLadAdapter directly"
```

---

## Verification Summary

After all 4 tasks: `npm test` and `npm run test:e2e` both green, `git log` shows 4 focused commits, and `grep -rn "detectAnnexPresentSync\|createDataLadAdapter" src/ test/` returns no output.
