# PRISM Badge and Save Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For a PRISM project (`project.json` in the root), Save is allowed only when `prism-validator` reports the whole project valid; a PRISM badge shows in the project strip.

**Architecture:** An Electron-free module `src/datalad/prism-gate.js` (injected runner, fake-runner tests) makes the decision; `main.js`'s `adapter:runCommand` calls it for `save` and returns a synthetic blocked result (identity-guard shape) or clears `request.paths`; the renderer only displays (badge, hint, error list).

**Tech Stack:** Node built-ins only, existing `ProcessRunner`, run registry, `managed-env.js` (`envBin`, `envStatus`).

**Spec:** `docs/superpowers/specs/2026-10-03-prism-save-gate-design.md`

## Global Constraints

- Gate = `prism-validator <projectPath> --format json`, PRISM checks only (no `--bids`); verdict from `results.valid === true` and `summary.total_errors === 0`; exit codes are NOT relied on; warnings never block.
- Fail closed: crash, timeout (300000 ms), cancel, bad JSON, unknown report shape, validator not installed, git error → Save blocked.
- Exempt only the save that introduces `project.json` (`git cat-file -e HEAD:project.json` exits 128).
- Enforcement lives in the main process; renderer data (`prism:inspect`) is display-only.
- Zero new npm dependencies; TDD red-green per task; `npm test` (one pre-existing unrelated failure: `adapter parity: getInterfaceContract matches JS adapter`).

## Review Focus

- Validator exits non-zero WITH valid JSON on invalid data → must still read as `invalid`, not `unchecked` (parse stdout before looking at `failed`). Test in Task 2.
- `valid: true` but `total_errors > 0` (contradictory report) → `invalid`. Test in Task 1.
- Validator prints non-JSON preamble before the JSON → blocked as `unchecked`, never allowed. Test in Task 1.
- Project path with spaces → passed as one argv element. Test in Task 2.
- Selecting only some files in a PRISM project → main clears `paths` so the validated tree is what is committed. Verified in Task 3's e2e.
- Git missing/unusable when checking the conversion exemption → blocked (`unchecked`), not exempt. Test in Task 2.

---

### Task 1: Pure helpers

**Files:**
- Create: `src/datalad/prism-gate.js`
- Test: `test/prism-gate.test.js`

**Interfaces:**
- Produces: `PRISM_MARKER`, `isPrismProject(projectPath) → Promise<boolean>`, `isConversionSave({ runner, projectPath }) → Promise<boolean>` (true on exit 128, false on 0, throws otherwise), `interpretReport(stdout) → { verdict:'valid' } | { verdict:'invalid', errorCount, errors:string[] } | { verdict:'unknown', reason }`.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { interpretReport, isConversionSave, isPrismProject } from '../src/datalad/prism-gate.js'

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
```

- [ ] **Step 2: Run, expect FAIL** — `node --test test/prism-gate.test.js` → module not found.

- [ ] **Step 3: Implement**

```js
import { access } from 'node:fs/promises'
import { join } from 'node:path'

export const PRISM_MARKER = 'project.json'
const MAX_LISTED_ERRORS = 10

export const isPrismProject = (projectPath) =>
  access(join(projectPath, PRISM_MARKER)).then(() => true, () => false)

// `git cat-file -e HEAD:project.json` exits 128 when the file is not in HEAD or there is no HEAD
// yet: this save introduces project.json, so validation starts with the next one.
export async function isConversionSave({ runner, projectPath }) {
  const result = await runner.run('git', ['-C', projectPath, 'cat-file', '-e', `HEAD:${PRISM_MARKER}`])
  if (result.exitCode === 0) return false
  if (result.exitCode === 128) return true
  throw new Error(`git could not check ${PRISM_MARKER}: ${result.stderr || `exit ${result.exitCode}`}`)
}

const oneLine = (entry) => {
  if (typeof entry === 'string') return entry
  const where = entry?.path ?? entry?.file
  const what = entry?.message ?? entry?.description
  if (where && what) return `${where}: ${what}`
  return what ?? JSON.stringify(entry)
}

export function interpretReport(stdout) {
  let report
  try {
    report = JSON.parse(stdout)
  } catch {
    return { verdict: 'unknown', reason: 'The validator did not return a readable report.' }
  }
  const results = report?.results
  if (typeof results?.valid !== 'boolean') {
    return { verdict: 'unknown', reason: 'The validator report has no verdict.' }
  }
  const total = report.summary?.total_errors ?? results.summary?.total_errors ?? 0
  if (results.valid && total === 0) return { verdict: 'valid' }
  const errors = Array.isArray(results.errors) ? results.errors : []
  return {
    verdict: 'invalid',
    errorCount: Math.max(total, errors.length),
    errors: errors.slice(0, MAX_LISTED_ERRORS).map(oneLine)
  }
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Do not commit** (the user wants one combined commit at the end).

---

### Task 2: `gateSave`

**Files:**
- Modify: `src/datalad/prism-gate.js`
- Test: `test/prism-gate.test.js`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `gateSave({ runner, projectPath, validatorBin, checkValidator, signal, onOutput, timeoutMs = 300000 }) → { allow: true, gated: boolean } | { allow: false, result }`. `checkValidator` is `async () => boolean`. `result` = `{ ok:false, commandName:'save', exitCode:1, stdout:'', stderr:'', failed:true, warnings:[], userError:{ code, title, message, technicalDetails, items? } }`; codes `PRISM_INVALID | PRISM_UNCHECKED | PRISM_VALIDATOR_MISSING`.

- [ ] **Step 1: Write the failing tests** (append)

```js
import { gateSave } from '../src/datalad/prism-gate.js'

// Fake runner: git cat-file → gitExit; validator → the given result.
function fakeRunner({ gitExit = 0, validator } = {}) {
  const calls = []
  return {
    calls,
    async run(command, args, options) {
      calls.push([command, ...args])
      if (command === 'git') return { failed: gitExit !== 0, exitCode: gitExit, stdout: '', stderr: gitExit === 127 ? 'no git' : '' }
      return validator(args, options)
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

test('non-PRISM projects pass straight through, ungated, without running anything', async () => {
  const runner = fakeRunner()
  const dir = await mkdtemp(join(tmpdir(), 'plain '))
  assert.deepEqual(await gate(runner, dir), { allow: true, gated: false })
  assert.equal(runner.calls.length, 0)
})

test('the conversion save is allowed without validating', async () => {
  const runner = fakeRunner({ gitExit: 128, validator: () => assert.fail('must not validate') })
  assert.deepEqual(await gate(runner, await prismDir()), { allow: true, gated: false })
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
  assert.deepEqual(await gate(runner, dir), { allow: true, gated: true })
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
```

- [ ] **Step 2: Run, expect FAIL** — `gateSave` not exported.
- [ ] **Step 3: Implement** (append)

```js
const DEFAULT_TIMEOUT_MS = 300000

const blocked = (code, title, message, extra = {}) => ({
  allow: false,
  result: {
    ok: false,
    commandName: 'save',
    exitCode: 1,
    stdout: '',
    stderr: '',
    failed: true,
    warnings: [],
    userError: { code, title, message, technicalDetails: '', ...extra }
  }
})

const unchecked = (technicalDetails) =>
  blocked('PRISM_UNCHECKED', 'PRISM check could not run', "Couldn't check your data, so nothing was saved. Try again.", { technicalDetails })

export async function gateSave({ runner, projectPath, validatorBin, checkValidator, signal, onOutput, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!(await isPrismProject(projectPath))) return { allow: true, gated: false }

  try {
    if (await isConversionSave({ runner, projectPath })) return { allow: true, gated: false }
  } catch (error) {
    return unchecked(String(error.message))
  }

  if (!(await checkValidator())) {
    return blocked(
      'PRISM_VALIDATOR_MISSING',
      'PRISM validator needed',
      'The PRISM check needs a one-time install. Open Setup and click Install under PRISM Validator.'
    )
  }

  const run = await runner.run(validatorBin, [projectPath, '--format', 'json'], { signal, onOutput, timeoutMs })
  if (run.cancelled) return unchecked('Cancelled.')

  // The validator exits non-zero for invalid data, so the report (not the exit code) decides.
  const report = interpretReport(run.stdout)
  if (report.verdict === 'valid') return { allow: true, gated: true }
  if (report.verdict === 'invalid') {
    const count = report.errorCount
    const problems = count > 0 ? ` (${count} problem${count === 1 ? '' : 's'})` : ''
    return blocked(
      'PRISM_INVALID',
      'PRISM check failed',
      `Your data doesn't pass the PRISM check yet${problems}. Fix them and save again.`,
      { items: report.errors }
    )
  }
  return unchecked([report.reason, run.stderr].filter(Boolean).join('\n'))
}
```

- [ ] **Step 4: Run, expect PASS** — `node --test test/prism-gate.test.js`.
- [ ] **Step 5: No commit.**

---

### Task 3: Main-process wiring, inspect IPC, e2e

**Files:**
- Modify: `src/gui/main.js` (`adapter:runCommand` handler; new `prism:inspect`), `src/gui/preload.js`, `e2e/electron-driver.mjs` (return `userDataDir`)
- Create: `e2e/prism-gate.e2e.mjs`
- Test: the e2e file (POSIX only; it is skipped on Windows)

**Interfaces:**
- Consumes: Task 2 `gateSave`, Task 1 helpers, spec B `envBin`/`envStatus`/`managedEnvDir()`.
- Produces: IPC `prism:inspect(projectPath) → { isPrism, validatorReady, introducesPrism }`; preload `inspectPrism(projectPath)`; blocked Save returns `gate.result` (renderer shows it).

- [ ] **Step 1: Write the failing e2e** `e2e/prism-gate.e2e.mjs` (red because Save is not gated yet; look at `e2e/git-identity.e2e.mjs` for the helpers it copies):

```js
// A PRISM project (project.json in HEAD) may only be saved when the validator says it is valid.
// Uses a fake prism-validator seeded into the app's managed env (POSIX only).
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'

const skip = process.platform === 'win32' ? 'fake validator is a shell script' : false
let app
let projectPath

const git = (...args) => execFileSync('git', ['-C', projectPath, ...args], { encoding: 'utf8' })
const commitCount = () => Number(git('rev-list', '--count', 'HEAD'))

const FAKE = `#!/bin/sh
if [ -e "$1/INVALID" ]; then
  echo '{"summary":{"total_errors":1},"results":{"valid":false,"errors":[{"path":"sub-01","message":"missing sidecar"}]}}'
  exit 1
fi
echo '{"summary":{"total_errors":0},"results":{"valid":true,"errors":[]}}'
`

test.before(async () => {
  if (skip) return
  const root = await mkdtemp(join(tmpdir(), 'dlad-e2e-prism-'))
  projectPath = join(root, 'dataset')
  execFileSync('datalad', ['create', projectPath], { stdio: 'ignore' })
  await writeFile(join(projectPath, 'project.json'), '{}')
  execFileSync('datalad', ['-C', projectPath, 'save', '-m', 'add project.json'], { stdio: 'ignore' })
  app = await launchApp()
  const bin = join(app.userDataDir, 'env', 'bin')
  await mkdir(bin, { recursive: true })
  await writeFile(join(bin, 'prism-validator'), FAKE)
  await chmod(join(bin, 'prism-validator'), 0o755)
  await app.openProject(projectPath)
})

test.after(async () => {
  await app?.close()
})

const save = async (message) => {
  await app.page.evaluate((m) => {
    const input = document.getElementById('message')
    input.value = m
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.getElementById('save-project').click()
  }, message)
}

test('shows the PRISM badge for a project with project.json', { skip }, async () => {
  await app.page.waitForSelector('#current-project-prism-badge:not([hidden])', { timeout: 15_000 })
})

test('a valid project saves, and only the validated state is committed even if one file is selected', { skip }, async () => {
  await writeFile(join(projectPath, 'a.txt'), 'a')
  await writeFile(join(projectPath, 'b.txt'), 'b')
  const before = commitCount()
  await save('e2e: valid')
  await app.page.waitForFunction(() => document.getElementById('command-output').textContent.includes('Saved'), undefined, { timeout: 60_000 })
  assert.equal(commitCount(), before + 1)
  assert.equal(git('status', '--porcelain').trim(), '') // both files were saved, not just a selection
})

test('an invalid project is blocked: nothing is committed and the problem is shown', { skip }, async () => {
  await writeFile(join(projectPath, 'INVALID'), 'x')
  const before = commitCount()
  await save('e2e: invalid')
  await app.page.waitForFunction(
    () => document.getElementById('command-output').textContent.includes("doesn't pass the PRISM check"),
    undefined,
    { timeout: 60_000 }
  )
  const text = await app.page.evaluate(() => document.getElementById('command-output').textContent)
  assert.match(text, /sub-01: missing sidecar/)
  assert.equal(commitCount(), before)
})
```

Note: the first test needs the badge (Task 4), so only the last two should be red/green in this task; the badge test goes green in Task 4. Check what a successful save prints in `#command-output` (`grep -n "Saved" src/gui/renderer/app.js`) and use the real wording in the assertion.

- [ ] **Step 2: Expose `userDataDir`** — in `e2e/electron-driver.mjs` change `return { ...app, gitConfigGlobal }` to `return { ...app, gitConfigGlobal, userDataDir }`.
- [ ] **Step 3: Run, expect FAIL** — `node --test e2e/prism-gate.e2e.mjs` (the invalid save currently commits).
- [ ] **Step 4: Wire `main.js`.** Add the import `import { gateSave, isConversionSave, isPrismProject } from '../datalad/prism-gate.js'` and `envBin` to the existing managed-env import. Replace the body of `adapter:runCommand` so it reads:

```js
ipcMain.handle('adapter:runCommand', async (event, payload) => {
  if (!COMMANDS_CREATING_A_NEW_PROJECT.has(payload.commandName)) {
    requireAuthorizedRoot(payload.request?.projectPath)
  }

  let request = payload.request
  if (payload.commandName === 'save') {
    const gate = await runWithHandle(event, payload.runId, (runOptions) =>
      gateSave({
        runner: consoleRunner,
        projectPath: request.projectPath,
        validatorBin: envBin(managedEnvDir(), 'prism-validator'),
        checkValidator: async () => (await envStatus({ runner: consoleRunner, envDir: managedEnvDir() })).ready,
        ...runOptions
      })
    )
    if (!gate.allow) {
      return gate.result
    }
    // The validator checked the whole project, so commit the whole project: whatever the UI selected.
    if (gate.gated) {
      request = { ...request, paths: [] }
    }
  }

  const result = await runWithHandle(event, payload.runId, (runOptions) =>
    adapter.runCommand(payload.commandName, request, runOptions)
  )
  if (
    result?.ok &&
    (payload.commandName === 'cloneInstall' || payload.commandName === 'createProject')
  ) {
    authorizeRoot(request?.targetPath)
  }
  return result
})

ipcMain.handle('prism:inspect', async (_event, projectPath) => {
  requireAuthorizedRoot(projectPath)
  const isPrism = await isPrismProject(projectPath)
  if (!isPrism) {
    return { isPrism: false, validatorReady: false, introducesPrism: false }
  }
  const validatorReady = (await envStatus({ runner: consoleRunner, envDir: managedEnvDir() })).ready
  const introducesPrism = await isConversionSave({ runner: consoleRunner, projectPath }).catch(() => false)
  return { isPrism, validatorReady, introducesPrism }
})
```

- [ ] **Step 5: Preload** — add `inspectPrism: (projectPath) => ipcRenderer.invoke('prism:inspect', projectPath),`.
- [ ] **Step 6: Run, expect PASS** for the two save tests — `node --test e2e/prism-gate.e2e.mjs` (badge test still fails until Task 4); then `npm test`.
- [ ] **Step 7: No commit.**

---

### Task 4: Badge, hints, error list

**Files:**
- Modify: `src/gui/renderer/save-gating.js`, `src/gui/renderer/index.html`, `src/gui/renderer/app.js`
- Test: `test/save-gating.test.js`

**Interfaces:**
- Consumes: `api.inspectPrism`, result shape with `userError.items` / `userError.code`.
- Produces: `computeSaveGating({..., prismMode })` where `prismMode` is `undefined | 'gated' | 'conversion'`.

- [ ] **Step 1: Failing tests** (append to `test/save-gating.test.js`)

```js
test('PRISM project: selection is not required and the hint says everything is checked and saved together', () => {
  const gating = computeSaveGating({ hasMessage: true, hasSelection: false, hasConflicts: false, hasChanges: true, prismMode: 'gated' })
  assert.equal(gating.disabled, false)
  assert.match(gating.guidance.text, /checked before every save, and everything is saved together/)
  assert.equal(gating.guidance.warning, false)
})

test('the save that adds project.json explains checking starts next time', () => {
  const gating = computeSaveGating({ hasMessage: true, hasSelection: true, hasConflicts: false, hasChanges: true, prismMode: 'conversion' })
  assert.match(gating.guidance.text, /adds project\.json/)
})

test('PRISM mode never hides conflicts', () => {
  const gating = computeSaveGating({ hasMessage: true, hasSelection: true, hasConflicts: true, hasChanges: true, prismMode: 'gated' })
  assert.equal(gating.disabled, true)
  assert.match(gating.guidance.text, /Resolve conflicts/)
})
```

- [ ] **Step 2: Run, expect FAIL** — `node --test test/save-gating.test.js`.
- [ ] **Step 3: Implement in `save-gating.js`.** Add `prismMode` to the destructured input (and its JSDoc), then:

```js
  const selected = hasSelection || prismMode === 'gated'
  const disabled = hasConflicts || (hasChanges && !selected)
```
(replacing the existing `disabled` line and using `selected` in the "Select changed files" branch), and replace the final `if (hasChanges)` branch with:

```js
  if (hasChanges) {
    const texts = {
      gated: 'PRISM project: your data is checked before every save, and everything is saved together.',
      conversion: 'This save adds project.json. Checking starts with your next save.'
    }
    return { disabled, guidance: { text: texts[prismMode] ?? 'Ready to save selected changes.', warning: false } }
  }
```
(For `gated`, a missing message still shows the "Add a checkpoint message" hint first; that is fine.)

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Badge markup** — in `index.html`, directly after the `current-project-bids-badge` span add `<span id="current-project-prism-badge" class="badge badge-bids" hidden>PRISM</span>`.
- [ ] **Step 6: `app.js`.** (a) `state`: add `rootProjectPrism: null,` next to `rootProjectIsBids`. (b) element lookup: `currentProjectPrismBadge: document.getElementById('current-project-prism-badge'),` beside the BIDS one. (c) after `setBidsBadge` add:

```js
async function refreshPrismInspect(projectPath) {
  try {
    const info = await api.inspectPrism(projectPath)
    if (projectPath !== state.rootProjectPath) return
    state.rootProjectPrism = info.isPrism ? info : null
  } catch {
    state.rootProjectPrism = null
  }
  elements.currentProjectPrismBadge.hidden = !state.rootProjectPrism
  updateSaveButtonState()
}
```
(d) in `detectProjectType`, right after `state.rootProjectIsBids = Boolean(result.isBids)` add `state.rootProjectPrism = null` and, after `setCurrentProjectHeader(...)`, `void refreshPrismInspect(projectPath)`. (e) in `updateSaveButtonState` pass `prismMode: state.rootProjectPrism ? (state.rootProjectPrism.introducesPrism ? 'conversion' : 'gated') : undefined`. (f) after a successful save refresh the hint: in `runWorkflowCommand`'s success block (`if (result.ok && nextProjectPath) {`) add `if (commandName === 'save') void refreshPrismInspect(nextProjectPath)`.
(g) in `renderCommandResult`, directly after the `shouldShowUserErrorMessage` paragraph add:

```js
    if (Array.isArray(result.userError.items) && result.userError.items.length > 0) {
      html += `<ul>${result.userError.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    }
    if (result.userError.code === 'PRISM_VALIDATOR_MISSING') {
      html += '<p><button type="button" class="button button-ghost button-inline" data-open-setup>Open Setup</button></p>'
    }
```
(inside the `if (shouldShowUserErrorMessage(result)) {` block) and wire the button next to the other `commandOutput` handlers: `elements.commandOutput.addEventListener('click', (event) => { if (event.target.closest('[data-open-setup]')) elements.openSettingsButton.click() })`.

- [ ] **Step 7: Verify** — `npm test` (only the pre-existing parity failure), `node --test e2e/prism-gate.e2e.mjs` (all three pass, including the badge), then `node --test --test-concurrency=1 e2e/*.e2e.mjs` to confirm no other e2e regressed.
- [ ] **Step 8: Real-validator check** (blocked on the PyPI release): install the validator from Setup, run Save on (a) a valid and (b) an invalid PRISM dataset, confirm the verdict, that `--format json` without `--bids` is PRISM-only, and what an invalid `results.errors` entry looks like; adjust `oneLine` if needed.
- [ ] **Step 9: Commit once**, together with spec A and this plan: `git add -A src test e2e docs && git commit` with message "feat: PRISM badge and Save gate" and the Co-Authored-By trailer.
