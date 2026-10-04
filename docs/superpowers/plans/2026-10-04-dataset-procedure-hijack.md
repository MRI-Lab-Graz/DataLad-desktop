# Security Blocker Fixes (2026-10-04) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the confirmed code-execution path through dataset-shipped DataLad procedures, harden the elevated Windows installer, and get the branch to a deployable state.

**Architecture:** Fix the root cause once in `ProcessRunner`'s child environment: every `datalad` the app starts is told to ignore procedures stored inside datasets. Then, as defense in depth, folder trust also reports such procedures. Finally, the installer stops running a pre-existing machine Python with admin rights.

**Tech Stack:** Node ≥20 ESM, `node:test`, Electron 42, DataLad 1.6.x, git-annex, NSIS (electron-builder), uv 0.12.22.

**Spec:** the security assessment of 2026-10-03 (this conversation; summary below, under "Findings this plan implements").

## Findings this plan implements

1. **HIGH, reproduced with DataLad 1.6.5.** In Create Project, an existing BIDS folder that is *already a DataLad dataset* (for example, a plain `git clone` or a zip of someone's dataset) goes through "adopt". The app runs `datalad create -c text2git --force <folder>` ([app.js:577](../../../src/gui/renderer/app.js)). DataLad looks for procedures in the dataset's own `.datalad/procedures/` **before** its built-in ones, so a shipped `cfg_text2git.sh` runs. `findExecVectors` returns `[]` because it only checks `.git/config` and hooks, so the trust dialog never appears.
   - Verified 2026-10-03: `DATALAD_LOCATIONS_DATASET__PROCEDURES=<path of an existing file>` makes `datalad run-procedure --discover` list only the built-in `cfg_text2git`.
   - The auto-nesting of `sub-*` folders (`createSubdataset -c text2git --force`) is NOT exploitable: `create` discovers procedures before the new subdataset is initialised. The subdataset still keeps the shipped script afterwards, which Task 1 neutralises too.
2. **MEDIUM (Windows installer).** The installer runs `py -3.12` / `python` from the machine PATH **elevated**. A Python in a folder ordinary users can write to (`C:\Python312` inherits "Authenticated Users: Modify") lets them plant code (`sitecustomize.py`) that runs as admin.
3. **Docs.** SECURITY.md must describe the procedures control. University deployments should ship `policy.json` with `{"consoleDisabled": true}`.

## Global Constraints

- TDD for every change: failing test first, then the implementation (CLAUDE.md). Run tests with `npm test`.
- Zero new npm dependencies (memory: zero-dependency posture).
- Never spawn git bare or unpinned. Keep the guard tests green: `test/workflow-security`, `windows-installer`, `folder-trust`, `ipc-guard`, `process-runner`, `security-doc`.
- One commit per task. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Branch: `fix/security-hardening` (already checked out).
- Test fixtures that ship a procedure must only write a marker file inside the test's own temp dir.

## Review Focus

1. **Windows:** DataLad on Windows must honour the env override when its value is an absolute `C:\...exe` path. This is pinned by Task 1's real-datalad test, which runs in the Windows smoke CI.
2. **An existing user's own dataset that legitimately ships `.datalad/procedures`** now shows the trust prompt once. That is the expected behaviour, and it must not crash or loop. Pinned by Task 2's "trusted folder is not re-asked" check (existing trust-store test plus the new vector).
3. **`.datalad/config` missing, empty or unparseable:** the scanner must not throw. Unparseable means flagged, matching the "unreadable is not safe" rule. Pinned in Task 2.
4. **A procedures entry that is a dangling annex symlink** (content not fetched) must still be flagged. Pinned in Task 2.
5. **The env var must not break datalad's own built-in procedures:** `createProject` with `text2git` must still apply text2git. Pinned in Task 1's integration test (it checks `.gitattributes`).

---

### Task 1: DataLad never runs procedures stored inside a dataset

**Files:**
- Modify: `src/datalad/process-runner.js` (`childEnv`, around lines 20-31)
- Test: `test/process-runner.test.js` (append)

**Interfaces:**
- Produces: every child process gets `DATALAD_LOCATIONS_DATASET__PROCEDURES = process.execPath`. That is an existing file, so DataLad's `iglob(<file>/cfg_*)` matches nothing. It is admin-owned in packaged installs, and no dataset can create files "inside" it.

- [ ] **Step 1: Write the failing tests** (append to `test/process-runner.test.js`; `mkdtemp`, `writeFile`, `readFile`, `tmpdir`, `join` are already imported there)

```js
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'

test('ProcessRunner tells datalad to ignore procedures shipped inside a dataset', async () => {
  const runner = new ProcessRunner()
  const result = await runner.run(process.execPath, ['-e', 'process.stdout.write(process.env.DATALAD_LOCATIONS_DATASET__PROCEDURES ?? "")'])
  assert.equal(result.stdout, process.execPath)
})

const hasDatalad = (() => { try { execFileSync('datalad', ['--version'], { stdio: 'ignore' }); return true } catch { return false } })()

// Regression for the 2026-10-03 finding: adopting a folder that is already a dataset ran its own cfg_text2git.
test('create -c text2git --force on an existing dataset runs datalad\'s procedure, not the dataset\'s', { skip: !hasDatalad && 'datalad not installed' }, async () => {
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/process-runner.test.js`
Expected: the env test FAILS (`'' !== '/…/node'`). The datalad test FAILS with "the dataset-shipped procedure ran".

- [ ] **Step 3: Minimal implementation.** In `childEnv`, after `env.GIT_LITERAL_PATHSPECS = '1'`:

```js
  // A dataset can ship .datalad/procedures/cfg_<name> that datalad prefers over its own
  // (create -c text2git --force on an adopted dataset ran it). Point the dataset-procedures
  // location at a file: nothing can be found "inside" it.
  env.DATALAD_LOCATIONS_DATASET__PROCEDURES = process.execPath
```

Also extend the comment above `childEnv` ("Hardening applied to every child: …") with: "and datalad never runs procedures a dataset ships."

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/process-runner.test.js && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/datalad/process-runner.js test/process-runner.test.js
git commit -m "fix: datalad never runs procedures shipped inside a dataset"
```

---

### Task 2: Folder trust reports dataset-shipped procedures

Defense in depth: a datalad started outside the app (terminal, older app version) would still prefer the shipped script, so the user should be warned when opening such a folder.

**Files:**
- Modify: `src/gui/folder-trust.js` (`scan`, after the hooks loop, before the `.gitmodules` block)
- Test: `test/folder-trust.test.js` (append; reuse the `repo()` and `flagged()` helpers at the top of the file)

**Interfaces:**
- Consumes: the `repo()` and `flagged()` test helpers that already exist.
- Produces: new vector strings `${prefix}datalad procedure <name>` and `${prefix}datalad config <key>`.

- [ ] **Step 1: Write the failing tests**

```js
import { symlink } from 'node:fs/promises'

test('a procedure shipped in .datalad/procedures is flagged', async () => {
  const dir = await repo()
  await mkdir(join(dir, '.datalad', 'procedures'), { recursive: true })
  await writeFile(join(dir, '.datalad', 'procedures', 'cfg_text2git.sh'), '#!/bin/sh\n')
  assert.match(await flagged(dir), /datalad procedure cfg_text2git\.sh/)
})

test('a not-yet-downloaded (dangling symlink) procedure is flagged too', { skip: process.platform === 'win32' && 'symlinks need privileges' }, async () => {
  const dir = await repo()
  await mkdir(join(dir, '.datalad', 'procedures'), { recursive: true })
  await symlink('../../.git/annex/objects/missing', join(dir, '.datalad', 'procedures', 'cfg_x.py'))
  assert.match(await flagged(dir), /datalad procedure cfg_x\.py/)
})

test('.datalad/config keys that name procedures or their locations are flagged', async () => {
  const dir = await repo()
  await mkdir(join(dir, '.datalad'), { recursive: true })
  await writeFile(join(dir, '.datalad', 'config'),
    '[datalad "dataset"]\n\tid = 1234\n[datalad "procedures.cfg_text2git"]\n\tcall-format = sh -c x\n[datalad "locations"]\n\tdataset-procedures = code\n')
  const out = await flagged(dir)
  assert.match(out, /datalad config datalad\.procedures\.cfg_text2git\.call-format/)
  assert.match(out, /datalad config datalad\.locations\.dataset-procedures/)
  assert.doesNotMatch(out, /datalad\.dataset\.id/)
})

test('an unparseable .datalad/config is flagged, not ignored', async () => {
  const dir = await repo()
  await mkdir(join(dir, '.datalad'), { recursive: true })
  await writeFile(join(dir, '.datalad', 'config'), '[broken\n')
  assert.match(await flagged(dir), /datalad config \(unreadable\)/)
})
```

The existing test `a freshly created DataLad dataset is not flagged` (line ~159) must stay green. A real `datalad create` writes only `datalad.dataset.id` and has no `procedures/` folder.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/folder-trust.test.js`
Expected: the 4 new tests FAIL (no `datalad procedure` / `datalad config` output).

- [ ] **Step 3: Minimal implementation.** In `scan()`, after the hooks loop. `top` is computed further down, so move the `const top = await git(['rev-parse', '--show-toplevel'])` line up above this block and reuse it in the `.gitmodules` block.

```js
  // datalad prefers a dataset's own .datalad/procedures over its built-in ones, and reads
  // procedure settings from the committed .datalad/config.
  if (!top.failed) {
    const root = top.stdout.trim()
    let procedures = []
    try {
      procedures = await readdir(join(root, '.datalad', 'procedures'))
    } catch {
      // none shipped
    }
    for (const name of procedures) found.push(`${prefix}datalad procedure ${name}`)

    const dlcfg = await runner.run('git', ['config', '--file', join(root, '.datalad', 'config'), '--list', '-z'])
    if (dlcfg.failed && dlcfg.exitCode !== 1) {
      found.push(`${prefix}datalad config (unreadable)`) // exit 1 = file missing/empty
    }
    for (const entry of dlcfg.failed ? [] : dlcfg.stdout.split('\0').filter(Boolean)) {
      const key = entry.split('\n')[0].toLowerCase()
      if (/^datalad\.(procedures|locations)\./.test(key)) found.push(`${prefix}datalad config ${key}`)
    }
  }
```

Before relying on `exitCode !== 1`, check git's exit code for a missing file: run `git config --file /nonexistent --list` and confirm it exits 1. If it uses a different code, adjust the condition so a missing `.datalad/config` is not flagged. The real-dataset test protects this.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/folder-trust.test.js && npm test`
Expected: all PASS, including `a freshly created DataLad dataset is not flagged`.

- [ ] **Step 5: Commit**

```bash
git add src/gui/folder-trust.js test/folder-trust.test.js
git commit -m "fix: folder trust reports procedures a dataset ships for datalad to run"
```

---

### Task 3: Installer builds the DataLad env with the bundled uv, not an elevated system Python

**Decide at the start of the day.** Do this task (recommended), or defer it and list it under "Known limitations" in SECURITY.md. It cannot be verified on the Mac: the `installer-smoke` workflow on `windows-latest` is the check.

Why uv: it already ships in `resources/uv/uv.exe` and downloads its own checksum-verified Python. That removes the elevated `py`/`python` calls *and* the whole python.org download step (less code).

**Files:**
- Modify: `build/installer.nsh` (delete the "Checking for Python 3.12..." block; rewrite the "Installing DataLad into its own environment..." command)
- Modify: `test/windows-installer.test.js` (the `downloads.length >= 3` assertion becomes `>= 2`, and the message becomes 'expected Git and git-annex downloads')
- Test: `test/windows-installer.test.js` (append)

- [ ] **Step 1: Write the failing tests** (append)

```js
test('the installer never runs a pre-existing system Python with admin rights', () => {
  assert.doesNotMatch(nsh, /\bpy -3|python -m venv|python -c|Get-Command (py|python)\b/)
})

test('the DataLad env is built by the bundled uv with its own managed Python inside the install folder', () => {
  assert.match(nsh, /\$INSTDIR\\resources\\uv\\uv\.exe/)
  assert.match(nsh, /UV_PYTHON_INSTALL_DIR = '\$INSTDIR\\python'/)
  assert.match(nsh, /venv --no-config --managed-python --python 3\.12/)
  assert.match(nsh, /pip install --no-config .*--require-hashes --only-binary :all: --no-deps/)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/windows-installer.test.js`
Expected: both new tests FAIL.

- [ ] **Step 3: Implementation.** Delete the whole `; The DataLad lock file is compiled for Python 3.12...` through `DetailPrint "Python 3.12 already present."` / `${EndIf}` block. Replace the DataLad install `nsExec::ExecToLog` line with:

```nsis
  nsExec::ExecToLog `${PS} -NoProfile -Command "${MACHINE_PATH} $$env:UV_PYTHON_INSTALL_DIR = '$INSTDIR\python'; $$env:UV_CACHE_DIR = '$PLUGINSDIR\uv-cache'; $$uv = '$INSTDIR\resources\uv\uv.exe'; $$venv = '$INSTDIR\datalad-env'; & $$uv venv --no-config --managed-python --python 3.12 $$venv; if ($$LASTEXITCODE -ne 0) { exit $$LASTEXITCODE }; & $$uv pip install --no-config --python $$venv --link-mode copy --index-url https://pypi.org/simple --require-hashes --only-binary :all: --no-deps -r '$INSTDIR\resources\datalad-requirements.txt'; exit $$LASTEXITCODE"`
```

In `customUnInstall`, next to `RMDir /r "$INSTDIR\datalad-env"`, add `RMDir /r "$INSTDIR\python"`. Update the header comment: Python is no longer downloaded, because uv brings a verified Python into the install folder. Check `uv venv --help` for `--managed-python`. If uv 0.12.22 spells it differently, use `--python-preference only-managed` and update the test regex to match.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/windows-installer.test.js && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit, push, and run the real check**

```bash
git add build/installer.nsh test/windows-installer.test.js
git commit -m "fix: installer builds the DataLad env with the bundled uv and its own Python, never an elevated system Python"
git push
gh workflow run installer-smoke.yml --ref fix/security-hardening
```

Read the **e2e/install step log**, not just the job conclusion (memory: flaky CI). `install.log` must show `DataLad install exit 0`.

---

### Task 4: Docs and university deployment note

**Files:**
- Modify: `SECURITY.md` (Controls: new bullet; Known limitations: deferred items below)
- Modify: `CHANGELOG.md`
- Test: `test/security-doc.test.js` (append)

- [ ] **Step 1: Write the failing test**

```js
test('SECURITY.md documents that dataset-shipped datalad procedures are neutralised', () => {
  assert.match(doc, /DATALAD_LOCATIONS_DATASET__PROCEDURES/)
  assert.match(doc, /\.datalad\/procedures/)
  const runner = readFileSync(new URL('../src/datalad/process-runner.js', import.meta.url), 'utf8')
  assert.match(runner, /DATALAD_LOCATIONS_DATASET__PROCEDURES/)
})
```

- [ ] **Step 2: Run it, verify it fails** — `node --test test/security-doc.test.js`

- [ ] **Step 3: Write the docs.** Under Controls, add: every datalad the app starts gets `DATALAD_LOCATIONS_DATASET__PROCEDURES`, so procedures in a dataset's `.datalad/procedures` never run; folder trust also reports them and `datalad.procedures.*` / `datalad.locations.*` in `.datalad/config`. Under Known limitations, add the deferred items below. Add a "Recommended for institutional deployment" line: ship `policy.json` with `{"consoleDisabled": true}` in the system folder. Add a CHANGELOG entry.

- [ ] **Step 4: Run** `npm test`. Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add SECURITY.md CHANGELOG.md test/security-doc.test.js
git commit -m "docs: dataset-shipped procedures control, institutional deployment advice"
```

---

### Task 5: Release gate (nothing ships before every box is ticked)

- [ ] `npm test`: all pass (432 + new tests)
- [ ] `npm run test:e2e`: all pass (unset `ELECTRON_RUN_AS_NODE` first; memory gotcha)
- [ ] `npm audit --omit=dev`: 0 vulnerabilities
- [ ] Re-run the Task 1 scenario by hand in the **packaged** app (`npm run package:mac:arm64`, open it). Make a test dataset that ships a `cfg_text2git` writing a marker file in its own temp folder, then adopt it via Create Project. The marker must not appear, and the trust dialog must appear.
- [ ] `installer-smoke` green on Windows, with `install.log` read (Task 3)
- [ ] Smoke cross-platform workflow green (it runs Task 1's datalad test on Windows: Review Focus #1)
- [ ] Update memory `project_security_hardening_branch.md` with the outcome

---

## Deferred (written into SECURITY.md Known limitations in Task 4, not fixed)

- **`adapter:detectProject` authorizes any git repo the renderer names, and `adapter:inspectBidsCandidate` reads folder names anywhere** ([main.js:188-201](../../../src/gui/main.js)). These only matter if the renderer itself is compromised, and the CSP (`script-src 'self'`, no frames) plus the IPC sender check make that unlikely. Confining them would break the hand-typed Create Project path ([app.js:250](../../../src/gui/renderer/app.js)). Revisit if the renderer ever loads remote content.
- **git-annex `autoenable` special remotes in a cloned dataset** were not tested. Expected impact: network connections the user did not choose, not code execution (only already-installed `git-annex-remote-*` helpers run). Test it if a reviewer asks.
- **Unsigned releases:** a decision already made by the user. SHA256SUMS and provenance attestation are in place.
