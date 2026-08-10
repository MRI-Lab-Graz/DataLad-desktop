# Windows git-annex CI Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get real evidence — not assumption — that DataLad Desktop's Save/annex flow actually works for a non-admin Windows user, by running real `datalad`/`git-annex` in CI on `windows-latest` and `macos-latest`.

**Architecture:** No app code changes. This is a CI + test-harness change: install real DataLad/git-annex on the existing smoke-test matrix the same non-elevated way `datalad-gooey`'s own CI does, add one new e2e spec that proves a Save round-trips through real git-annex (`git annex whereis`), and fix the e2e assertions that were unknowingly relying on git-annex being *absent*.

**Tech Stack:** Node's built-in test runner (`node --test`), `playwright-core` (already a devDependency) for CDP-driven Electron control, `datalad-installer` (pip) for the CI-only annex install, GitHub Actions.

## Global Constraints

- No WSL/virtualization redesign — git-annex's own adjusted-unlocked-branch fallback already solves the Windows symlink-privilege problem with zero elevation; only fix concrete bugs this verification surfaces.
- No changes to `src/datalad/adapter.js` or the Rust bridge unless a task below finds an actual bug — none is known going in.
- No new e2e mocking/test framework — everything reuses the existing `node --test` + `electron-driver.mjs` harness and `e2e/fixtures.mjs` conventions.
- The DataLad/git-annex install step in CI applies to the whole `smoke-cross-platform.yml` matrix (`windows-latest` + `macos-latest`), not gated to one OS.
- Primary validation for the Windows-specific behavior is manual, on the maintainer's local Windows VM, before the CI workflow change is pushed (see spec's Rollout section) — that step is outside this plan's automatable tasks and is called out explicitly in Task 4.

---

### Task 1: Land the e2e-launch hang fix

**Context:** From a prior session in this repo: `e2e/electron-driver.mjs`'s `launchApp()` didn't clean up the spawned Electron process when startup failed, so a broken selector wait hung the whole CI job for its full 6-hour timeout instead of failing in seconds. Separately, `#check-env` moved into a `hidden` Setup panel (opened via `#open-settings`) without the e2e driver being updated to click it open first — that's what was triggering the failure in the first place. Both fixes are already written and verified working in this working tree's `e2e/electron-driver.mjs`, just not committed. This task is: reproduce that exact fix (or confirm it's already present) and commit it, since every later task in this plan depends on the Windows/macOS smoke job actually reaching the steps this plan adds.

**Files:**
- Modify: `e2e/electron-driver.mjs`

**Interfaces:**
- Produces: `launchApp(): Promise<{ page, openProject(projectPath), buttonState(id), close() }>` — same public shape as before, now rejects promptly (no dangling child process) on any startup failure, and opens the Setup panel before returning.

- [ ] **Step 1: Confirm/apply the target file content**

Check `e2e/electron-driver.mjs` matches the following exactly. If it already does (likely, since this was done earlier in the same working tree), skip to Step 2. If working from a fresh checkout/worktree, write this full file:

```js
// Launches the real DataLad Desktop app and connects to it over Chrome
// DevTools Protocol so tests can drive the actual renderer DOM — not a
// mock of it. Requires `playwright-core` (devDependency) but not a full
// Playwright install. See test/e2e in package.json scripts for usage.
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import electronPath from 'electron'

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

export async function launchApp() {
  // Setting this to '' (rather than deleting it) does NOT reliably clear it
  // on Windows: empty-string env vars get dropped when child_process builds
  // the Windows environment block, so the parent's truthy value (if any)
  // leaks through and Electron launches in "run as Node" mode instead of
  // as a real app — surfacing as "module 'electron' does not provide an
  // export named 'BrowserWindow'". Deleting the key avoids the platform
  // quirk entirely.
  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE

  const child = spawn(electronPath, [APP_DIR, '--remote-debugging-port=0'], {
    cwd: APP_DIR,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  try {
    return await connect(child)
  } catch (err) {
    // A failure below (e.g. #check-env never appears) leaves the spawned
    // Electron process and any open CDP socket dangling. Nothing then
    // references them, so node --test never exits its event loop until CI's
    // job timeout kills it hours later. Callers whose test.before() throws
    // never get an `app` to call close() on, so the cleanup has to happen
    // here, not by the caller.
    child.kill()
    throw err
  }
}

async function connect(child) {
  const port = await new Promise((resolve, reject) => {
    let buffer = ''
    const onData = (chunk) => {
      buffer += chunk.toString()
      const match = buffer.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)
      if (match) {
        cleanup()
        resolve(Number(match[1]))
      }
    }
    const onExit = (code) => {
      cleanup()
      reject(new Error(`Electron exited before DevTools came up (code ${code}). Output:\n${buffer}`))
    }
    const cleanup = () => {
      child.stdout.off('data', onData)
      child.stderr.off('data', onData)
      child.off('exit', onExit)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', onExit)
    setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for Electron DevTools port. Output so far:\n${buffer}`))
    }, 20_000)
  })

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)

  try {
    return await attachToWindow(browser, child)
  } catch (err) {
    await browser.close().catch(() => {})
    throw err
  }
}

async function attachToWindow(browser, child) {
  let page = null
  for (let attempt = 0; attempt < 20 && !page; attempt += 1) {
    for (const ctx of browser.contexts()) {
      for (const candidate of ctx.pages()) {
        if (!candidate.url().startsWith('devtools://')) {
          page = candidate
        }
      }
    }
    if (!page) {
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  if (!page) {
    throw new Error('Could not find the app window over CDP')
  }
  // #check-env lives inside the Setup panel, which starts `hidden` until
  // #open-settings is clicked.
  await page.waitForSelector('#open-settings', { timeout: 10_000 })
  await page.evaluate(() => document.getElementById('open-settings').click())
  await page.waitForSelector('#check-env', { timeout: 10_000 })

  async function openProject(projectPath) {
    // setCurrentProjectHeader fires off refreshProjectHealth without
    // awaiting it, so the path/badge can update before the health-driven
    // button gating has actually been (re)computed. The health card is the
    // only visible signal that the async fetch (and therefore
    // applyRemoteGatedButtons) has completed for *this* project rather than
    // a previous one — so clear it to a sentinel first, then wait for it to
    // be replaced, instead of guessing a fixed delay or risking a match
    // against stale content left over from the last project opened.
    await page.evaluate(() => {
      document.getElementById('project-health-output').innerHTML = 'e2e-pending'
    })

    await page.evaluate((p) => {
      const input = document.getElementById('project-path')
      input.value = p
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, projectPath)
    await page.evaluate(() => document.getElementById('detect-project').click())
    // detectProject spawns real git/datalad subprocesses through the main
    // process. The first spawn of a given probe on a loaded CI VM (cold
    // process creation, antivirus scanning on Windows runners, etc.) can
    // take much longer than on a warm local machine — a 10s budget was
    // observed timing out in CI on the very first 'dataset' classification
    // probe while the very next (superdataset) probe finished in well under
    // a second, so this is CI spawn latency, not an app hang.
    await page.waitForFunction(
      (p) => document.getElementById('current-project-path').textContent === p,
      projectPath,
      { timeout: 30_000 }
    )
    await page.waitForFunction(
      () => document.getElementById('project-health-output').innerHTML.includes('project-health-grid'),
      { timeout: 30_000 }
    )
  }

  async function buttonState(id) {
    return page.evaluate((elementId) => {
      const el = document.getElementById(elementId)
      return { disabled: el.disabled, title: el.title, text: el.textContent.trim(), classes: el.className }
    }, id)
  }

  async function close() {
    await browser.close().catch(() => {})
    child.kill()
  }

  return { page, openProject, buttonState, close }
}
```

- [ ] **Step 2: Run the previously-hanging test to confirm it now fails fast instead of hanging**

Run (macOS/Linux):
```bash
env -u ELECTRON_RUN_AS_NODE node --test --test-concurrency=1 e2e/busy-state.e2e.mjs
```
On Windows (no env var unset needed there): `npm run test:e2e -- e2e/busy-state.e2e.mjs`

Expected: completes in well under a minute (previously hung 6 hours). It should now pass — a passing run confirms `#open-settings` correctly reveals `#check-env` on the target machine.

- [ ] **Step 3: Commit**

```bash
git add e2e/electron-driver.mjs
git commit -m "fix: stop e2e launchApp from hanging CI for 6h on a failed startup

launchApp() left the spawned Electron process and CDP connection
dangling whenever startup failed, so node --test never exited until
CI's 6h job timeout force-killed it. It also never opened the Setup
panel that #check-env now lives inside of, which is what was causing
every startup to fail in the first place."
```

---

### Task 2: Fix e2e assertions that were only passing because git-annex was absent

**Context:** `e2e/button-gating.e2e.mjs`'s `createDatasetFixture`/`createSuperdatasetFixture` (from `e2e/fixtures.mjs`) build a fake "dataset" — a plain git repo with a hand-written `.datalad/config` — with no real annexed content, by design, so it works identically whether or not `datalad`/`git-annex` are installed. Two tests assert `Get Data` is *enabled* against these fixtures. That was only ever true because `git annex find --not --in here` — the health probe behind `computeDatasetGating` in `src/gui/renderer/button-gating.js:41` — fails to spawn when git-annex isn't installed, and a failed probe defaults to "not annex-supported," which doesn't trip the "nothing to fetch" rule. Once git-annex *is* installed (as it now is on the author's dev machine, and as this plan is about to make true in CI), that same probe succeeds against a fixture with zero annexed content, correctly reports zero missing files, and `computeDatasetGating` correctly disables Get Data as a no-op — this is the app's `NOTHING_TO_GET_TITLE` gating path (`button-gating.js:16-17`) working exactly as designed. The two tests' expectations are stale, not the app. A third test (`'Check Setup shows a busy state...'`) separately asserts the post-run button text is `'Check Setup'`, which predates a button rename to `'Check Environment'` (`src/gui/renderer/index.html:65`).

This was verified directly: with real `datalad`/`git-annex` installed, applying the fixes below took the full `e2e/*.e2e.mjs` suite from 17/20 passing to 21/21 passing (20 pre-existing + the new spec from Task 3).

**Files:**
- Modify: `e2e/button-gating.e2e.mjs`

**Interfaces:**
- Consumes: `createDatasetFixture(root)`, `createSuperdatasetFixture(root)` from `e2e/fixtures.mjs` (unchanged); `app.buttonState(id)` from `e2e/electron-driver.mjs` (unchanged, Task 1).

- [ ] **Step 1: Update the two Get Data assertions**

In `e2e/button-gating.e2e.mjs`, replace:

```js
test('DataLad dataset with no remote: Get Data enabled, Update/Publish still disabled', async () => {
  const projectPath = await createDatasetFixture(root)
  await app.openProject(projectPath)

  const getData = await app.buttonState('get-data')
  const update = await app.buttonState('update-project')
  const unlock = await app.buttonState('unlock-files')

  assert.equal(getData.disabled, false)
  assert.equal(update.disabled, true)
  assert.equal(unlock.disabled, false)
})

test('DataLad superdataset: Get Data enabled', async () => {
  const projectPath = await createSuperdatasetFixture(root)
  await app.openProject(projectPath)

  const getData = await app.buttonState('get-data')
  const unlock = await app.buttonState('unlock-files')
  assert.equal(getData.disabled, false)
  assert.equal(unlock.disabled, false)
})
```

with:

```js
test('DataLad dataset with no remote: nothing to fetch so Get Data is disabled, Update/Publish still disabled', async () => {
  const projectPath = await createDatasetFixture(root)
  await app.openProject(projectPath)

  const getData = await app.buttonState('get-data')
  const update = await app.buttonState('update-project')
  const unlock = await app.buttonState('unlock-files')

  // The fixture never had any annexed content, so once a real git-annex
  // resolves health (it's not installed on most CI runners, but is on a
  // contributor's machine or the Windows/macOS smoke job), `git annex find
  // --not --in here` reports nothing missing and Get Data is correctly
  // disabled as a no-op, not because this isn't a recognized dataset.
  assert.equal(getData.disabled, true)
  assert.match(getData.title, /nothing to get/)
  assert.equal(update.disabled, true)
  assert.equal(unlock.disabled, false)
})

test('DataLad superdataset: nothing to fetch so Get Data is disabled', async () => {
  const projectPath = await createSuperdatasetFixture(root)
  await app.openProject(projectPath)

  const getData = await app.buttonState('get-data')
  const unlock = await app.buttonState('unlock-files')
  assert.equal(getData.disabled, true)
  assert.match(getData.title, /nothing to get/)
  assert.equal(unlock.disabled, false)
})
```

- [ ] **Step 2: Fix the stale button-text assertion**

In the same file, in the `'Check Setup shows a busy state...'` test, replace:
```js
  assert.equal(done.text, 'Check Setup')
```
with:
```js
  assert.equal(done.text, 'Check Environment')
```

- [ ] **Step 3: Run the fixed file and confirm it passes**

With real `datalad`/`git-annex` installed locally (skip/expect pre-existing failures if not — this file's other tests don't need them, but these three specifically do):
```bash
env -u ELECTRON_RUN_AS_NODE node --test --test-concurrency=1 e2e/button-gating.e2e.mjs
```
Expected: all tests in the file pass (`# fail 0`).

- [ ] **Step 4: Commit**

```bash
git add e2e/button-gating.e2e.mjs
git commit -m "fix: correct e2e Get Data assertions for when git-annex is actually installed

These fixtures never had real annexed content, so once a real
git-annex resolves project health (as it now does whenever git-annex
is installed, rather than always failing the probe), Get Data is
correctly disabled as a no-op — that's the app's existing
'nothing to get' gating working as designed, not a bug. Also fixes
a stale 'Check Setup' button-text assertion left over from its
rename to 'Check Environment'."
```

---

### Task 3: Add a real end-to-end annex round-trip test

**Context:** Nothing in this repo's test suite has ever driven a real `datalad create` / `datalad save` and checked the result with real `git-annex`. This is the one test that actually proves the thing this whole plan exists to verify: that clicking Save on a real dataset hands the file to git-annex successfully, regardless of whether git-annex is using symlinks or (on a Windows machine without symlink privilege) an adjusted unlocked branch. `git annex whereis` is the right check because it succeeds identically in both cases — it's asking "does git-annex know a copy of this file's content exists here," not "is this file a symlink."

This was run and verified locally (with real `datalad`/`git-annex` installed) before being written into this plan: `node --test --test-concurrency=1 e2e/real-annex-roundtrip.e2e.mjs` passed in ~21s.

**Files:**
- Create: `e2e/real-annex-roundtrip.e2e.mjs`

**Interfaces:**
- Consumes: `launchApp()` from `e2e/electron-driver.mjs` (Task 1) — same shape as used by every other e2e spec.
- Requires (unlike every other e2e spec): a real `datalad` and `git-annex` on `PATH`. This is the one spec allowed to depend on that, per the doc comment below.

- [ ] **Step 1: Write the spec**

Create `e2e/real-annex-roundtrip.e2e.mjs`:

```js
// Every other e2e fixture deliberately avoids a real `datalad`/`git-annex`
// install (see fixtures.mjs) so the suite behaves the same on CI runners
// that don't have one. This spec is the one exception: it requires a real
// DataLad install and proves the app's Save button actually round-trips
// through git-annex, not just through the UI. In particular this is what
// verifies the Windows case, where git-annex has no symlink privilege and
// silently switches the dataset to an "adjusted unlocked branch" (annexed
// files become plain regular files instead of symlinks) - `git annex
// whereis` succeeds identically either way, so it's a platform-agnostic
// proof that Save actually handed the file to git-annex.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'

let app
let projectPath

test.before(async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-e2e-real-'))
  projectPath = join(root, 'real-dataset')
  execFileSync('datalad', ['create', projectPath], { stdio: 'ignore' })
  app = await launchApp()
})

test.after(async () => {
  await app?.close()
})

test('Save on a real DataLad dataset hands the file to git-annex', async () => {
  await writeFile(join(projectPath, 'roundtrip.txt'), 'e2e real-annex roundtrip\n')
  await app.openProject(projectPath)

  await app.page.evaluate(() => {
    const input = document.getElementById('message')
    input.value = 'e2e: real annex roundtrip'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await app.page.evaluate(() => document.getElementById('save-project').click())

  await app.page.waitForFunction(
    () => {
      const el = document.getElementById('save-project')
      return !el.disabled && el.textContent.trim() === 'Save Checkpoint'
    },
    { timeout: 30_000 }
  )

  // Throws (failing the test) if git-annex never picked up the file, e.g.
  // because Save errored before it reached `datalad save`.
  const whereis = execFileSync('git', ['annex', 'whereis', 'roundtrip.txt'], {
    cwd: projectPath,
    encoding: 'utf8'
  })
  assert.match(whereis, /\(\d+ cop(?:y|ies)\)/)
})
```

- [ ] **Step 2: Run it to verify it passes**

Requires `datalad` and `git-annex` on `PATH` locally (`datalad --version`, `git-annex version` to check). Run:
```bash
env -u ELECTRON_RUN_AS_NODE node --test --test-concurrency=1 e2e/real-annex-roundtrip.e2e.mjs
```
Expected: `# pass 1`, `# fail 0`.

- [ ] **Step 3: Run the full e2e suite together to confirm no interference**

```bash
env -u ELECTRON_RUN_AS_NODE node --test --test-concurrency=1 e2e/*.e2e.mjs
```
Expected: `# tests 21`, `# pass 21`, `# fail 0` (17 pre-existing + 3 fixed in Task 2's file counted individually + this new one — exact count depends on how many `test(...)` blocks are in each file, but `# fail 0` is what matters).

- [ ] **Step 4: Commit**

```bash
git add e2e/real-annex-roundtrip.e2e.mjs
git commit -m "test: add real datalad/git-annex save round-trip e2e spec

Nothing in this suite previously exercised real git-annex. This spec
proves Save actually hands the file to git-annex via 'git annex
whereis', which succeeds identically whether git-annex used a
symlink or (Windows without symlink privilege) an adjusted unlocked
branch — the platform-agnostic proof this verification effort needs."
```

---

### Task 4: Install real DataLad/git-annex in CI and validate on the local Windows VM

**Context:** This is the task that actually makes the prior three matter: without git-annex installed in CI, Task 2's fixed assertions and Task 3's new spec both silently no-op past the very thing they're meant to catch (Task 3's `datalad create` would simply fail to spawn). `datalad-installer`'s `datalad/packages` method is the same non-elevated install method `datalad-gooey`'s own CI (`.appveyor.yml`) uses — no admin rights, no Developer Mode toggle, matching a real non-technical Windows user's machine.

**Files:**
- Modify: `.github/workflows/smoke-cross-platform.yml`

**Interfaces:** None — this is CI configuration only, no code interfaces.

- [ ] **Step 1: Add the install step**

In `.github/workflows/smoke-cross-platform.yml`, insert a new step between `Install dependencies` and `Run unit smoke tests`:

```yaml
      - name: Install DataLad + git-annex
        run: |
          python -m pip install datalad-installer datalad
          datalad-installer --sudo ok git-annex -m datalad/packages
```

Full resulting `steps:` list:

```yaml
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Install DataLad + git-annex
        run: |
          python -m pip install datalad-installer datalad
          datalad-installer --sudo ok git-annex -m datalad/packages

      - name: Run unit smoke tests
        run: npm test

      - name: Run UI e2e tests (real Electron window)
        run: npm run test:e2e

      - name: Run packaging smoke build (unpacked)
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'
        run: npm run package:dir
```

No changes to the `matrix:` block — this applies to both `windows-latest` and `macos-latest` as-is.

- [ ] **Step 2: Validate on the local Windows VM before pushing**

On the maintainer's local Windows VM (no admin rights, Developer Mode left at its default/off state — matching a real user's machine):
```powershell
python -m pip install datalad-installer datalad
datalad-installer --sudo ok git-annex -m datalad/packages
npm ci
npm test
npm run test:e2e
```
Expected: all pass, with no elevation prompt at any point. If `npm run test:e2e` fails specifically on the new `real-annex-roundtrip.e2e.mjs` spec or on Get Data gating, that's a genuine, now-concrete bug (not hypothetical) — stop here and investigate before proceeding; it is out of scope for this plan to guess the fix in advance.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/smoke-cross-platform.yml
git commit -m "ci: install real DataLad + git-annex on the smoke-cross-platform matrix

Uses the same non-elevated datalad-installer method datalad-gooey's
own CI uses (datalad/packages), so Windows and macOS smoke runs now
exercise real git-annex instead of silently skipping it. Validated
locally on a non-admin Windows VM before landing."
```

- [ ] **Step 4: Push and watch the Windows job**

Push the branch and watch the `Smoke (windows-latest, Node 22)` job in `smoke-cross-platform.yml` run to completion (not a 6h timeout — Task 1 already fixed that failure mode). A fully green run across `npm test`, `npm run test:e2e`, and `npm run package:dir` is the evidence needed to endorse the app for its Windows audience.
