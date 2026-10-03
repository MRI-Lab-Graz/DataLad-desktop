# Managed Python Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app owns a private, uv-built Python environment containing `prism-validator`, installable with one click in Setup, on macOS/Windows/Linux.

**Architecture:** One Electron-free module `src/datalad/managed-env.js` takes an injected `ProcessRunner`-shaped runner and paths, so it is tested with a fake runner. `main.js` wires two IPC handlers (cancellable via the existing run registry). uv is bundled per OS via electron-builder `extraResources`, fetched and checksum-verified in CI.

**Tech Stack:** Node built-ins only (`node:test`, `node:fs/promises`, `node:crypto`), uv (bundled binary), existing `ProcessRunner`/run registry.

**Spec:** `docs/superpowers/specs/2026-10-03-managed-env-design.md`

## Global Constraints

- Python pinned to `3.12`; validator pinned as `prism-validator==<PIN>` in one constants block (`MANAGED_ENV` in `managed-env.js`).
- uv is **bundled**, never downloaded at app runtime. Zero new npm dependencies.
- `ensureEnv` never leaves a half-built env: success returns ready, anything else deletes the folder.
- Env lives in `<userData>/env`. DataLad/git-annex are NOT in the env (out of scope).
- Tests: `npm test` (Node built-in runner), red-green per task, no real network in tests.

## Review Focus

- `prism-validator --version` may not exist in the real tool → `envStatus` would report not-ready forever. Pinned to the PRISM release; verify in the manual check (Task 5).
- Envdir path with spaces (`DataLad Desktop` on every OS) → passed as an argv element, never via shell. Test in Task 2.
- Two `env:ensure` runs at once (double click) → second must be refused, not race on `rm -rf`. Test in Task 4.
- Cancel mid-install → partial env deleted, result `cancelled`. Test in Task 2.
- uv missing/blocked (antivirus) → spawn error 127 yields a message naming the uv path. Test in Task 3.

---

### Task 1: Path helpers

**Files:**
- Create: `src/datalad/managed-env.js`
- Test: `test/managed-env.test.js`

**Interfaces:**
- Produces: `MANAGED_ENV = { python: '3.12', packages: ['prism-validator==0.0.0'] }` (placeholder pin is replaced by the real version when the PyPI release exists; the test only checks shape), `resolveUv(baseDir, platform)`, `envBin(envDir, name, platform)`.

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { envBin, resolveUv, MANAGED_ENV } from '../src/datalad/managed-env.js'

test('resolveUv points into the bundled uv folder, .exe on Windows only', () => {
  assert.equal(resolveUv('/res', 'darwin'), join('/res', 'uv', 'uv'))
  assert.equal(resolveUv('/res', 'linux'), join('/res', 'uv', 'uv'))
  assert.equal(resolveUv('/res', 'win32'), join('/res', 'uv', 'uv.exe'))
})

test('envBin uses Scripts/*.exe on Windows and bin/ elsewhere', () => {
  assert.equal(envBin('/e', 'prism-validator', 'win32'), join('/e', 'Scripts', 'prism-validator.exe'))
  assert.equal(envBin('/e', 'prism-validator', 'darwin'), join('/e', 'bin', 'prism-validator'))
})

test('MANAGED_ENV pins python and exact-version packages', () => {
  assert.match(MANAGED_ENV.python, /^3\.\d+$/)
  assert.ok(MANAGED_ENV.packages.every((p) => /==/.test(p)))
})
```

- [ ] **Step 2: Run, expect FAIL** — `node --test test/managed-env.test.js` → module not found.

- [ ] **Step 3: Implement**

```js
import { join } from 'node:path'

// One place to bump versions; changing `packages` makes ensureEnv reinstall.
export const MANAGED_ENV = { python: '3.12', packages: ['prism-validator==0.0.0'] }

const exe = (name, platform) => (platform === 'win32' ? `${name}.exe` : name)

export const resolveUv = (baseDir, platform = process.platform) => join(baseDir, 'uv', exe('uv', platform))

export const envBin = (envDir, name, platform = process.platform) =>
  join(envDir, platform === 'win32' ? 'Scripts' : 'bin', exe(name, platform))
```

- [ ] **Step 4: Run, expect PASS** — `node --test test/managed-env.test.js`
- [ ] **Step 5: Commit** — `git add src/datalad/managed-env.js test/managed-env.test.js && git commit -m "feat: add managed-env path helpers"`

---

### Task 2: envStatus and ensureEnv

**Files:**
- Modify: `src/datalad/managed-env.js`
- Test: `test/managed-env.test.js`

**Interfaces:**
- Consumes: Task 1 exports; a runner with `run(command, args, { signal, onOutput }) → { failed, cancelled?, stdout, stderr, exitCode }` (the `ProcessRunner` shape).
- Produces: `envStatus({ runner, envDir, platform? }) → { ready, validatorVersion }`; `ensureEnv({ runner, uvPath, envDir, config = MANAGED_ENV, signal, onOutput, platform? }) → { ready: true, validatorVersion } | { ready: false, cancelled?: true, failure: { stderr, exitCode, step } }`. After success it writes `<envDir>/managed-env.json` containing `config`; a matching marker plus a passing `envStatus` makes a second call a no-op.

- [ ] **Step 1: Write the failing tests** (fake runner records calls; `venv` creates the env dir and the install creates the marker-less executable path)

```js
import { mkdtemp, mkdir, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { ensureEnv, envStatus } from '../src/datalad/managed-env.js'

function fakeRunner({ failStep, cancelStep } = {}) {
  const calls = []
  return {
    calls,
    async run(command, args) {
      calls.push([command, ...args])
      const step = args[0] === 'venv' ? 'venv' : args[0] === 'pip' ? 'install' : 'verify'
      if (step === cancelStep) return { failed: true, cancelled: true, exitCode: 130, stdout: '', stderr: '' }
      if (step === failStep) return { failed: true, exitCode: 1, stdout: '', stderr: `${step} boom` }
      if (step === 'venv') await mkdir(args.at(-1), { recursive: true })
      return { failed: false, exitCode: 0, stdout: step === 'verify' ? 'prism-validator 1.2.3\n' : '', stderr: '' }
    }
  }
}
const fresh = async () => join(await mkdtemp(join(tmpdir(), 'env ')), 'env')
const exists = (p) => access(p).then(() => true, () => false)

test('ensureEnv creates the venv, installs pinned packages, verifies, and writes a marker', async () => {
  const envDir = await fresh() // path contains a space on purpose
  const runner = fakeRunner()
  const config = { python: '3.12', packages: ['prism-validator==1.2.3'] }
  const result = await ensureEnv({ runner, uvPath: '/uv', envDir, config })
  assert.deepEqual(result, { ready: true, validatorVersion: 'prism-validator 1.2.3' })
  assert.deepEqual(runner.calls[0], ['/uv', 'venv', '--python', '3.12', envDir])
  assert.deepEqual(runner.calls[1].slice(0, 4), ['/uv', 'pip', 'install', '--python'])
  assert.ok(runner.calls[1].includes('prism-validator==1.2.3'))
})

test('ensureEnv is a no-op when marker and validator are current, and reinstalls when the pin changes', async () => {
  const envDir = await fresh()
  const config = { python: '3.12', packages: ['prism-validator==1.2.3'] }
  await ensureEnv({ runner: fakeRunner(), uvPath: '/uv', envDir, config })
  const again = fakeRunner()
  await ensureEnv({ runner: again, uvPath: '/uv', envDir, config })
  assert.equal(again.calls.filter((c) => c[1] === 'venv').length, 0)
  const bumped = fakeRunner()
  await ensureEnv({ runner: bumped, uvPath: '/uv', envDir, config: { ...config, packages: ['prism-validator==1.2.4'] } })
  assert.equal(bumped.calls.filter((c) => c[1] === 'venv').length, 1)
})

for (const failStep of ['venv', 'install', 'verify']) {
  test(`ensureEnv deletes the env when ${failStep} fails`, async () => {
    const envDir = await fresh()
    const result = await ensureEnv({ runner: fakeRunner({ failStep }), uvPath: '/uv', envDir, config: MANAGED_ENV })
    assert.equal(result.ready, false)
    assert.equal(result.failure.step, failStep)
    assert.equal(await exists(envDir), false)
  })
}

test('ensureEnv reports cancelled and removes the partial env', async () => {
  const envDir = await fresh()
  const result = await ensureEnv({ runner: fakeRunner({ cancelStep: 'install' }), uvPath: '/uv', envDir, config: MANAGED_ENV })
  assert.equal(result.cancelled, true)
  assert.equal(await exists(envDir), false)
})

test('ensureEnv wipes a half-built env left by an interrupted earlier run', async () => {
  const envDir = await fresh()
  await mkdir(envDir, { recursive: true }) // exists, but no marker
  const runner = fakeRunner()
  await ensureEnv({ runner, uvPath: '/uv', envDir, config: MANAGED_ENV })
  assert.equal(runner.calls.filter((c) => c[1] === 'venv').length, 1)
})

test('envStatus is not ready when the validator cannot run', async () => {
  const status = await envStatus({ runner: fakeRunner({ failStep: 'verify' }), envDir: '/nope' })
  assert.deepEqual(status, { ready: false, validatorVersion: null })
})
```

- [ ] **Step 2: Run, expect FAIL** — `ensureEnv`/`envStatus` not exported.

- [ ] **Step 3: Implement** (append to `managed-env.js`)

```js
import { readFile, rm, writeFile } from 'node:fs/promises'

const MARKER = 'managed-env.json'
const sameConfig = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const firstLine = (text) => (text ?? '').split(/\r?\n/, 1)[0].trim() || null

export async function envStatus({ runner, envDir, platform }) {
  const result = await runner.run(envBin(envDir, 'prism-validator', platform), ['--version'], { timeoutMs: 15000 })
  return result.failed ? { ready: false, validatorVersion: null } : { ready: true, validatorVersion: firstLine(result.stdout || result.stderr) }
}

export async function ensureEnv({ runner, uvPath, envDir, config = MANAGED_ENV, signal, onOutput, platform }) {
  const marker = await readFile(join(envDir, MARKER), 'utf8').then(JSON.parse, () => null)
  if (marker && sameConfig(marker, config)) {
    const status = await envStatus({ runner, envDir, platform })
    if (status.ready) return status
  }

  // A stale, mismatched or half-built env is never patched: start clean.
  await rm(envDir, { recursive: true, force: true })
  const opts = { signal, onOutput }
  const steps = [
    ['venv', ['venv', '--python', config.python, envDir]],
    ['install', ['pip', 'install', '--python', envDir, ...config.packages]]
  ]
  for (const [step, args] of steps) {
    const result = await runner.run(uvPath, args, opts)
    if (result.failed) return fail(envDir, step, result)
  }
  const status = await envStatus({ runner, envDir, platform })
  if (!status.ready) return fail(envDir, 'verify', { stderr: 'prism-validator did not start after install', exitCode: 1 })
  await writeFile(join(envDir, MARKER), JSON.stringify(config))
  return status
}

async function fail(envDir, step, result) {
  await rm(envDir, { recursive: true, force: true })
  return { ready: false, ...(result.cancelled && { cancelled: true }), failure: { step, stderr: result.stderr, exitCode: result.exitCode } }
}
```

- [ ] **Step 4: Run, expect PASS** — `node --test test/managed-env.test.js`
- [ ] **Step 5: Commit** — `git commit -am "feat: ensureEnv builds and verifies the managed environment"` (add the test file too)

---

### Task 3: Plain-language failure messages

**Files:**
- Modify: `src/datalad/managed-env.js`
- Test: `test/managed-env.test.js`

**Interfaces:**
- Consumes: the `failure` object from Task 2 and `uvPath`.
- Produces: `describeEnvFailure({ failure, cancelled, uvPath }) → { code, message }` where `code` ∈ `CANCELLED | UV_BLOCKED | OFFLINE | PACKAGE_NOT_FOUND | DISK | UNKNOWN`. The raw stderr stays available to the caller as `failure.stderr`.

- [ ] **Step 1: Failing test**

```js
import { describeEnvFailure } from '../src/datalad/managed-env.js'

const d = (stderr, extra = {}) => describeEnvFailure({ failure: { stderr, exitCode: 1, step: 'install', ...extra }, uvPath: '/app/uv/uv' })

test('describeEnvFailure maps known stderr to plain-language codes', () => {
  assert.equal(d('error: No solution found ... Because prism-validator was not found in the package registry').code, 'PACKAGE_NOT_FOUND')
  assert.equal(d('error: Failed to fetch: dns error: failed to lookup address').code, 'OFFLINE')
  assert.equal(d('error: No space left on device (os error 28)').code, 'DISK')
  assert.equal(d('error: Permission denied (os error 13)').code, 'DISK')
  assert.equal(d('something odd').code, 'UNKNOWN')
})

test('a spawn failure (127) names the bundled uv path; cancel is its own code', () => {
  const blocked = d('spawn EACCES', { exitCode: 127 })
  assert.equal(blocked.code, 'UV_BLOCKED')
  assert.match(blocked.message, /\/app\/uv\/uv/)
  assert.equal(describeEnvFailure({ cancelled: true, failure: {}, uvPath: 'x' }).code, 'CANCELLED')
})
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**

```js
const FAILURES = [
  ['PACKAGE_NOT_FOUND', /not found in the package registry|No matching distribution|no versions of prism-validator/i,
    "The PRISM validator isn't available yet. Please try again later or contact your PRISM administrator."],
  ['OFFLINE', /dns error|failed to fetch|connection (refused|reset|timed out)|network|proxy/i,
    "Couldn't download. Check your internet connection (a university proxy can block this) and try again."],
  ['DISK', /no space left|permission denied|os error (13|28)/i,
    "There isn't enough disk space, or the app isn't allowed to write to its data folder."]
]

export function describeEnvFailure({ failure, cancelled, uvPath }) {
  if (cancelled) return { code: 'CANCELLED', message: 'Installation cancelled.' }
  if (failure.exitCode === 127) {
    return { code: 'UV_BLOCKED', message: `The installer helper could not start (${uvPath}). Security software may have blocked it.` }
  }
  const hit = FAILURES.find(([, pattern]) => pattern.test(failure.stderr ?? ''))
  return hit ? { code: hit[0], message: hit[2] } : { code: 'UNKNOWN', message: 'Installing the PRISM validator failed. See technical details.' }
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat: plain-language managed-env failure messages"`

---

### Task 4: IPC wiring and Setup UI

**Files:**
- Modify: `src/gui/main.js` (imports; handlers near `adapter:cancelCommand`), `src/gui/preload.js`, `src/gui/renderer/index.html` (new `setup-section` after "Local Environment"), `src/gui/renderer/app.js`
- Test: `test/managed-env.test.js` (concurrency guard), `e2e/` not changed

**Interfaces:**
- Consumes: Tasks 1–3, `runWithHandle`, `consoleRunner`.
- Produces: IPC `env:status` → `{ ready, validatorVersion }`; `env:ensure(runId)` → `{ ready, validatorVersion } | { ready:false, cancelled?, code, message, technical }`. Preload: `getManagedEnvStatus()`, `ensureManagedEnv(runId)`. Concurrency guard exported from the module: `createEnsureGuard()` → `{ run(fn) }` that throws `Error('Installation already running')` if re-entered.

- [ ] **Step 1: Failing test for the guard**

```js
import { createEnsureGuard } from '../src/datalad/managed-env.js'

test('createEnsureGuard refuses a second concurrent run but allows one after it finishes', async () => {
  const guard = createEnsureGuard()
  let release
  const first = guard.run(() => new Promise((r) => { release = r }))
  await assert.rejects(guard.run(async () => {}), /already running/)
  release('ok')
  assert.equal(await first, 'ok')
  assert.equal(await guard.run(async () => 'again'), 'again')
})
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement guard** (append to `managed-env.js`)

```js
export function createEnsureGuard() {
  let busy = false
  return {
    async run(fn) {
      if (busy) throw new Error('Installation already running')
      busy = true
      try { return await fn() } finally { busy = false }
    }
  }
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Wire main.js** — add imports `import { createEnsureGuard, describeEnvFailure, ensureEnv, envStatus, resolveUv } from '../datalad/managed-env.js'`; after `runRegistry` creation:

```js
const ensureGuard = createEnsureGuard()
// Packaged: electron-builder copies build/uv to <resources>/uv; dev: build/uv in the repo.
const uvBaseDir = () => (app.isPackaged ? process.resourcesPath : join(__dirname, '..', '..', 'build'))
const managedEnvDir = () => join(app.getPath('userData'), 'env')
```

and handlers next to `adapter:cancelCommand`:

```js
ipcMain.handle('env:status', () => envStatus({ runner: consoleRunner, envDir: managedEnvDir() }))

ipcMain.handle('env:ensure', (event, runId) =>
  ensureGuard.run(async () => {
    const uvPath = resolveUv(uvBaseDir())
    const result = await runWithHandle(event, runId, (runOptions) =>
      ensureEnv({ runner: consoleRunner, uvPath, envDir: managedEnvDir(), ...runOptions })
    )
    if (result.ready) return result
    const { code, message } = describeEnvFailure({ failure: result.failure, cancelled: result.cancelled, uvPath })
    return { ready: false, cancelled: result.cancelled, code, message, technical: result.failure.stderr }
  })
)
```

Cancel reuses `adapter:cancelCommand` (same registry).

- [ ] **Step 6: Preload** — add:

```js
  getManagedEnvStatus: () => ipcRenderer.invoke('env:status'),
  ensureManagedEnv: (runId) => ipcRenderer.invoke('env:ensure', runId),
```

- [ ] **Step 7: Setup UI** — in `index.html`, after the Local Environment `setup-section` add:

```html
        <div class="setup-section">
          <h3 class="setup-section-title">PRISM Validator</h3>
          <p class="lede-small">Checks that your data follows the PRISM structure. Installed privately for this app.</p>
          <p id="prism-env-status" class="lede-small"></p>
          <div class="row-actions">
            <button id="prism-env-install" class="button button-ghost button-inline" type="button">Install</button>
            <button id="prism-env-cancel" class="button button-ghost button-inline" type="button" hidden>Cancel</button>
          </div>
          <details id="prism-env-technical" hidden><summary>Technical details</summary><pre id="prism-env-technical-text" class="panel panel-code"></pre></details>
        </div>
```

In `app.js` add element lookups beside `checkEnvButton` and, near the Setup handlers (after the `environmentOutput` click listener):

```js
async function refreshPrismEnvStatus() {
  const s = await api.getManagedEnvStatus()
  elements.prismEnvStatus.textContent = s.ready ? `Ready (${s.validatorVersion})` : 'Not installed.'
  elements.prismEnvInstall.hidden = s.ready
}

elements.prismEnvInstall.addEventListener('click', async () => {
  const runId = `prism-env-${Date.now()}`
  elements.prismEnvInstall.hidden = true
  elements.prismEnvCancel.hidden = false
  elements.prismEnvCancel.onclick = () => api.cancelCommand(runId)
  elements.prismEnvStatus.textContent = 'Installing…'
  try {
    const r = await api.ensureManagedEnv(runId)
    elements.prismEnvTechnical.hidden = !r.technical
    elements.prismEnvTechnicalText.textContent = r.technical ?? ''
    if (!r.ready) elements.prismEnvStatus.textContent = r.message
    else await refreshPrismEnvStatus()
  } catch (error) {
    elements.prismEnvStatus.textContent = String(error.message ?? error)
  } finally {
    elements.prismEnvCancel.hidden = true
    elements.prismEnvInstall.hidden = false
  }
})

elements.openSettings?.addEventListener('click', () => refreshPrismEnvStatus().catch(() => {}))
```

(Match the existing `open-settings` element key in `elements`; add `prismEnvStatus`, `prismEnvInstall`, `prismEnvCancel`, `prismEnvTechnical`, `prismEnvTechnicalText` lookups by id.)

- [ ] **Step 8: Verify** — `npm test` (all pass). Launch per memory note (unset `ELECTRON_RUN_AS_NODE`): `env -u ELECTRON_RUN_AS_NODE npm start`, open Setup, confirm the PRISM Validator section shows "Not installed." and Install shows the "helper could not start" message when `build/uv/uv` is absent.
- [ ] **Step 9: Commit** — `git add -A src test && git commit -m "feat: install the PRISM validator environment from Setup"`

---

### Task 5: Bundle uv, uninstall, docs

**Files:**
- Create: `scripts/fetch-uv.mjs`
- Modify: `package.json` (`build.extraResources`, `build.nsis.deleteAppDataOnUninstall`, script `fetch:uv`), `.github/workflows/build-os-artifacts.yml` (run fetch before each package step), `.gitignore` (`build/uv/`), `README.md`
- Test: `test/packaging-config.test.js`

**Interfaces:**
- Produces: `node scripts/fetch-uv.mjs <target>` where `<target>` ∈ `aarch64-apple-darwin | x86_64-pc-windows-msvc | x86_64-unknown-linux-gnu`; leaves `build/uv/uv[.exe]` after verifying the pinned SHA-256. Exports `UV` pin table `{ version, targets: { [target]: { file, sha256 } } }` for the test.

- [ ] **Step 1: Failing tests** (append to `test/packaging-config.test.js`)

```js
import { UV } from '../scripts/fetch-uv.mjs'

test('uv is bundled for every build target with a pinned SHA-256', async () => {
  const pkg = JSON.parse(await read('package.json'))
  assert.deepEqual(pkg.build.extraResources, [{ from: 'build/uv', to: 'uv' }])
  for (const target of ['aarch64-apple-darwin', 'x86_64-pc-windows-msvc', 'x86_64-unknown-linux-gnu']) {
    assert.match(UV.targets[target].sha256, /^[0-9a-f]{64}$/, target)
  }
  assert.match(UV.version, /^\d+\.\d+\.\d+$/)
})

test('every packaging job fetches uv before electron-builder runs', async () => {
  const wf = await read('.github/workflows/build-os-artifacts.yml')
  for (const target of ['aarch64-apple-darwin', 'x86_64-pc-windows-msvc', 'x86_64-unknown-linux-gnu']) {
    assert.ok(wf.indexOf(`fetch-uv.mjs ${target}`) !== -1, `no fetch for ${target}`)
  }
})

test('Windows uninstall removes the app data folder that holds the managed env', async () => {
  assert.equal(JSON.parse(await read('package.json')).build.nsis.deleteAppDataOnUninstall, true)
})
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Get the real pins** — pick the current uv release `<V>` (https://github.com/astral-sh/uv/releases) and read each asset's published checksum:

```bash
V=<version>; for f in uv-aarch64-apple-darwin.tar.gz uv-x86_64-pc-windows-msvc.zip uv-x86_64-unknown-linux-gnu.tar.gz; do curl -sL https://github.com/astral-sh/uv/releases/download/$V/$f.sha256; done
```

- [ ] **Step 4: Write `scripts/fetch-uv.mjs`** using those values (no placeholders in the committed file):

```js
import { createHash } from 'node:crypto'
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

export const UV = {
  version: '<V>',
  targets: {
    'aarch64-apple-darwin': { file: 'uv-aarch64-apple-darwin.tar.gz', sha256: '<hash from step 3>' },
    'x86_64-pc-windows-msvc': { file: 'uv-x86_64-pc-windows-msvc.zip', sha256: '<hash from step 3>' },
    'x86_64-unknown-linux-gnu': { file: 'uv-x86_64-unknown-linux-gnu.tar.gz', sha256: '<hash from step 3>' }
  }
}

async function main(target) {
  const pin = UV.targets[target]
  if (!pin) throw new Error(`Unknown target: ${target}`)
  const bytes = Buffer.from(await (await fetch(`https://github.com/astral-sh/uv/releases/download/${UV.version}/${pin.file}`)).arrayBuffer())
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== pin.sha256) throw new Error(`uv checksum mismatch for ${pin.file}: ${actual}`)

  const out = new URL('../build/uv/', import.meta.url)
  const outDir = fileURLToPath(out)
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const archive = join(outDir, pin.file)
  await writeFile(archive, bytes)
  // tar (bsdtar on Windows 10+) extracts both .tar.gz and .zip.
  const { status } = spawnSync('tar', ['-xf', archive, '-C', outDir], { stdio: 'inherit' })
  if (status !== 0) throw new Error('tar extraction failed')
  const bin = target.includes('windows') ? 'uv.exe' : 'uv'
  const [inner] = await readdir(outDir, { withFileTypes: true }).then((e) => e.filter((d) => d.isDirectory()))
  if (inner) await rename(join(outDir, inner.name, bin), join(outDir, bin))
  await rm(archive)
  if (inner) await rm(join(outDir, inner.name), { recursive: true, force: true })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv[2])
```

(The `<V>` / `<hash>` tokens are filled from Step 3's output when this step is executed — the file is not committed with them.)

- [ ] **Step 5: package.json** — add to `build`: `"extraResources": [{ "from": "build/uv", "to": "uv" }]` and `"deleteAppDataOnUninstall": true` inside `nsis`; add script `"fetch:uv": "node scripts/fetch-uv.mjs"`. Add `build/uv/` to `.gitignore`.
- [ ] **Step 6: CI** — before each packaging step in `build-os-artifacts.yml` add `run: node scripts/fetch-uv.mjs aarch64-apple-darwin` (macOS job), `x86_64-pc-windows-msvc` (Windows), `x86_64-unknown-linux-gnu` (Linux).
- [ ] **Step 7: README** — under the install section add: "The PRISM validator installs privately from Setup → PRISM Validator (needs internet once). To remove it on macOS/Linux, delete `~/Library/Application Support/DataLad Desktop/env` (macOS) or `~/.config/DataLad Desktop/env` (Linux); Windows uninstall removes it automatically."
- [ ] **Step 8: Verify** — `npm test` passes. Locally: `node scripts/fetch-uv.mjs aarch64-apple-darwin && build/uv/uv --version`. Manual end-to-end on one real machine once `prism-validator` is on PyPI: set `MANAGED_ENV.packages` to the real pin, click Install, confirm Ready and that `prism-validator --version` works (adjust `envStatus` if the flag differs).
- [ ] **Step 9: Commit** — `git add scripts package.json .gitignore .github README.md test && git commit -m "feat: bundle uv and clean up the managed env on uninstall"`
