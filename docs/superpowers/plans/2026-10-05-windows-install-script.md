# Windows install script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-user, no-admin `install.cmd` for Windows that installs a hash-verified prebuilt app, a private DataLad environment, and Git/git-annex when missing, shipped on every release next to the unchanged NSIS installer.

**Architecture:** `install.cmd` wraps `install.ps1`. CI renders `install.ps1` from a template (version + zip hash filled in) and attaches it with the zip to the release. All behavior rules are pinned by text-level tests in the style of `test/windows-installer.test.js`; real behavior is proven by a CI job that runs the script on `windows-latest`.

**Tech Stack:** Windows PowerShell 5.1 (the `.ps1`), batch (`.cmd`), Node test runner (`npm test`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-05-windows-install-script-design.md`

## Global Constraints

- No admin rights: no `-Verb RunAs`; the machine PATH is never written; only the **user** PATH gets the private env's `Scripts` folder.
- Install folder: `%LOCALAPPDATA%\DataLad Desktop`. App settings live in `%APPDATA%` and are never touched.
- Every downloaded file is SHA-256-checked before it is run or extracted.
- git-annex comes from `https://datasets.datalad.org/datalad/packages/windows/git-annex-installer_<version>_x64.exe`, a versioned file, never `.../current/`.
- Pins, all together at the top of `install.ps1`: git-annex `10.20260901`, SHA-256 `582F0EF30AC9BE560285D9510F27EBDD95EBDF01719DEC42543B591F6BEF0095`; Git for Windows `https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.5/Git-2.55.0.5-64-bit.exe`, SHA-256 `D065A4E23C3D9A6B5073D609B5BE0830227EC3CA053C083BA385061DDFAF94C6` (copied from `build/installer.nsh`).
- DataLad: `resources\uv\uv.exe` from the verified zip, `uv venv --managed-python --python 3.12`, then `resources\datalad-requirements.txt` (hash-locked, wheels only). A system Python is never run.
- `install.cmd`: no parenthesised blocks, no `goto`.
- The NSIS installer and `build/installer.nsh` are not changed.
- New workflows must pass `test/workflow-security.test.js` (actions pinned to full SHAs, read-only default permissions, only the publish job writes).

## Review Focus

- Git or git-annex needs admin (system-wide Git under Program Files): expected a clear printed instruction and a non-zero exit, not a silent skip. Pinned by a test in Task 4.
- Username or path with spaces or non-ASCII characters (`C:\Users\Müller\AppData\Local`): every path is quoted and the install works. Pinned in Task 2.
- Re-running `install.cmd` for the version already installed: succeeds, loses nothing. Pinned in Task 5.
- Download fails or the hash mismatches during an upgrade: the previous install stays working. Pinned in Task 5.
- The app is running during an upgrade: the script stops with a message and changes nothing. Pinned in Task 5.
- Another `datalad` earlier on PATH (a stale pip launcher): the final output names it. Pinned in Task 3.

---

### Task 1: `install.cmd` wrapper and the rules test file

**Files:**
- Create: `scripts/windows/install.cmd`
- Create: `test/windows-install-script.test.js` (all later tasks add tests here; it reads `scripts/windows/install.cmd` and `scripts/windows/install.ps1` as text, like `test/windows-installer.test.js`)

**Interfaces:**
- Produces: `install.cmd` forwards all arguments (`%*`) to `install.ps1` in the same folder.

- [ ] **Step 1: Write the failing tests** `install.cmd runs install.ps1 with the execution policy bypassed and passes arguments on`, `install.cmd unblocks the downloaded files first`, `install.cmd has no parenthesised blocks and no goto`, `install.cmd pauses on failure so a double-click window stays open`.
- [ ] **Step 2: Run** `node --test test/windows-install-script.test.js`. Expected: FAIL, file not found.
- [ ] **Step 3: Create `install.cmd`** following prism-studio's wrapper: `setlocal`, `cd /d "%~dp0"`, `Unblock-File` on the folder, `powershell -NoProfile -ExecutionPolicy Bypass -File ".\install.ps1" %*`, `if errorlevel 1` lines (no blocks) that print a message, `pause` and `exit /b 1`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: install.cmd wrapper for the Windows install script`.

### Task 2: `install.ps1` skeleton, app download and safe swap

**Files:**
- Create: `scripts/windows/install.ps1`
- Modify: `test/windows-install-script.test.js`

**Interfaces:**
- Produces, in `install.ps1`: `param([string]$FromDir, [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'DataLad Desktop'), [switch]$Uninstall)`; pin variables `$AppVersion = '__VERSION__'`, `$AppZipSha256 = '__ZIP_SHA256__'` at the top beside the other pins; `Write-Log([string]$Message)` appends to `$InstallDir\install.log`; `Get-VerifiedFile([string]$Url, [string]$Sha256, [string]$OutFile)` downloads (or, for `-FromDir`, copies) and throws on a hash mismatch before returning; `Install-App` extracts to `"$InstallDir.new"`.
- Consumes: the placeholders are replaced by Task 6.

- [ ] **Step 1: Write the failing tests:** `the script never elevates and never writes the machine PATH` (no `RunAs`, no `'Machine'` in a `SetEnvironmentVariable` call); `every download goes through Get-VerifiedFile` (no bare `Invoke-WebRequest` outside it); `the zip hash check happens before Expand-Archive`; `the install folder defaults to LOCALAPPDATA`; `all pins sit together above the first function`; `every path built from InstallDir is quoted or joined with Join-Path` (no unquoted `$InstallDir\` inside a command line); `-FromDir still checks the hash`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** the signatures above. Stop with `Write-Log` and exit 1 if `DataLad Desktop.exe` is running from `$InstallDir` (the upgrade rule in Task 5 reuses this).
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: install.ps1 downloads and verifies the app zip`.

### Task 3: DataLad environment, user PATH, final report

**Files:**
- Modify: `scripts/windows/install.ps1`, `test/windows-install-script.test.js`

**Interfaces:**
- Produces: `Install-DataladEnv` (runs `$InstallDir\resources\uv\uv.exe` with `UV_PYTHON_INSTALL_DIR=$InstallDir\python`, env at `$InstallDir\datalad-env`); `Add-UserPath([string]$Dir)` (user scope only, no duplicate entry); `Write-Report` (prints where `datalad` resolves via `Get-Command datalad`, warns if that is not `$InstallDir\datalad-env\Scripts\datalad.exe`).

- [ ] **Step 1: Write the failing tests:** `DataLad installs from the zip's own uv and hash-locked requirements`; `uv uses --managed-python --python 3.12 and --no-config`; `no system Python is run` (no `python.exe`/`py ` invocation outside `$InstallDir`); `only the user PATH is written` (`'User'`, never `'Machine'`); `the report warns when datalad resolves elsewhere`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** per the interfaces, copying the `uv venv` / `uv pip install` flags from the DataLad step of `build/installer.nsh` (lines 94-98).
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: install.ps1 builds the private DataLad environment and adds it to the user PATH`.

### Task 4: Git and git-annex

**Files:**
- Modify: `scripts/windows/install.ps1`, `test/windows-install-script.test.js`

**Interfaces:**
- Produces: `Install-Git` and `Install-GitAnnex`, each a no-op when `Get-Command git` / `git-annex` succeeds. `Install-Git` runs the pinned installer with `/VERYSILENT /NORESTART /CURRENTUSER`. `Install-GitAnnex` runs the pinned installer with `/S`. On failure either writes the log, prints the manual instruction, and the script exits 1 at the end (after the other steps ran).

- [ ] **Step 1: Write the failing tests:** `the pinned git-annex URL is the versioned mirror file and never current`; `the pinned hashes equal the values in Global Constraints`; `git is installed per user (/CURRENTUSER)`; `a failed prerequisite prints manual instructions and makes the script exit non-zero`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** both functions with the exact pin values from Global Constraints.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: install.ps1 installs missing Git and git-annex from hash-pinned downloads`.

### Task 5: Shortcuts, upgrade rollback, uninstall

**Files:**
- Modify: `scripts/windows/install.ps1`, `test/windows-install-script.test.js`
- Create: `scripts/windows/uninstall.cmd` (copied into `$InstallDir` by `Install-App`)

**Interfaces:**
- Produces: `New-Shortcuts` (Start menu and desktop, target `$InstallDir\DataLad Desktop.exe`); `Invoke-Uninstall` (runs for `-Uninstall`: removes `$InstallDir`, the shortcuts and the user PATH entry from Task 3; never touches Python, Git or git-annex); `uninstall.cmd` copies `install.ps1` from its own folder to `%TEMP%` and runs it there with `-Uninstall -InstallDir "%~dp0"` so the script is not deleted while it runs.
- Consumes: `Install-App`'s swap from Task 2: old install renamed to `"$InstallDir.old"`, new moved in, `.old` deleted only after `datalad --version` from the new env succeeds, otherwise restored.

- [ ] **Step 1: Write the failing tests:** `the old install is renamed to .old and restored when a later step fails`; `.old is deleted only after datalad --version succeeded`; `the same version can be installed twice` (the second run replaces, no leftover `.new`); `uninstall removes the user PATH entry and the shortcuts`; `uninstall never removes Python, Git or git-annex`; `uninstall.cmd runs a copy of install.ps1 from TEMP`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** the functions and the `-Uninstall` branch.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: install.ps1 upgrades with rollback and uninstalls`.

### Task 6: Render script and release assets

**Files:**
- Create: `scripts/render-install-script.mjs`, `test/render-install-script.test.js`
- Modify: `.github/workflows/build-os-artifacts.yml` (Windows job and the SHA256SUMS step), `test/workflow-security.test.js` only if an existing test needs the new files named

**Interfaces:**
- Produces: `export function renderInstallScript(template: string, { version: string, zipSha256: string }): string`. It replaces `__VERSION__` and `__ZIP_SHA256__` and throws if either placeholder is missing from the template or the hash is not 64 hex characters. A CLI form `node scripts/render-install-script.mjs <version> <zip> <out>` hashes the zip and writes the rendered file.

- [ ] **Step 1: Write the failing tests:** `replaces both placeholders`; `throws when a placeholder is missing`; `throws on a malformed hash`; `the committed template still contains both placeholders`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** `renderInstallScript` and the CLI.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Edit the Windows job:** after the build, zip `dist/win-unpacked` as `DataLad-Desktop-<version>-win-x64.zip`, run the render CLI, copy `install.cmd` and `uninstall.cmd` into `dist/`, and add `dist/*.zip dist/install.cmd dist/install.ps1` to the artifact `path` (name stays `datalad-desktop-windows-x64`, so the publish job's `datalad-desktop-*` pattern picks them up). Extend `sha256sum` in the SHA256SUMS step with `*.cmd *.ps1`.
- [ ] **Step 6: Run** `npm test`. Expected: PASS, including `test/workflow-security.test.js`.
- [ ] **Step 7: Commit** `ci: publish the unpacked Windows zip with install.cmd and a rendered install.ps1`.

### Task 7: CI install test and pin freshness

**Files:**
- Create: `.github/workflows/install-script-smoke.yml`, `scripts/check-install-pins.mjs`, `test/check-install-pins.test.js`, `test/install-script-smoke-workflow.test.js`

**Interfaces:**
- Produces: `export async function checkPins({ fetchImpl, pins })` returning `{ ok: boolean, problems: string[], newerGitAnnex: string | null }`. It fails when the pinned git-annex or Git file's SHA-256 differs from the pin, and reports a newer git-annex version found in the mirror listing.

- [ ] **Step 1: Write the failing tests:** for `checkPins` (injected `fetchImpl`): `matching hashes pass`; `a changed file fails and names the pin`; `a newer version in the listing is reported`. For the workflow: `runs only on manual dispatch and v* tags` (same trigger rule as `installer-smoke.yml`); `runs install.cmd with -FromDir on a zip built in the same run`; `checks datalad --version from the install folder`; `runs e2e/packaged.e2e.mjs against the installed app`; `runs the pin check`; `runs uninstall and checks the folder is gone`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** `checkPins` and the workflow (`windows-latest`, `contents: read`, actions pinned to the SHAs used in `installer-smoke.yml`). The workflow builds `win-unpacked`, zips it, renders the script, runs `install.cmd -FromDir`, then the checks above.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `ci: smoke-test the Windows install script and check its pins`.

### Task 8: Documentation and a real run

**Files:**
- Modify: `README.md` (the Windows section), `CHANGELOG.md` if the repo keeps one

- [ ] **Step 1: Add** a Windows install section: download `install.cmd` and `install.ps1` from the release, double-click, what it installs, where, how to uninstall, and that the NSIS installer is still available.
- [ ] **Step 2: Run on the ARM64 VM:** download a built zip, run `install.cmd -FromDir <folder>`, open the app from the shortcut, run Save and Publish on the sample project. Record the result in the PR description.
- [ ] **Step 3: Run** `npm test`, then the manual `install-script-smoke.yml` workflow. Expected: PASS.
- [ ] **Step 4: Commit** `docs: Windows script install`.
