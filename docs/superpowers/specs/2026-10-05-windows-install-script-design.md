# Windows install script (`install.cmd`)

## Problem

The Windows NSIS installer is unsigned (there is no budget for a code-signing certificate, and SignPath is wired
but off), so SmartScreen warns on it and some university endpoint policies block it. It also runs elevated, downloads
and runs Git, Python and git-annex installers, and writes the machine PATH. Its git-annex pin points at the author's
moving `current/` URL, so the pinned hash fails (and git-annex is skipped) whenever upstream releases.

prism-studio (MRI-Lab-Graz) solved the same distribution problem with a text script: `install.cmd` (a `.cmd`, so
PowerShell's execution policy does not apply) runs one `.ps1` that does the work. DataLad Desktop will do the same.
The app will be installed by individual users, university-wide, so the supply-chain protections of the NSIS
installer (every download hash-checked, DataLad from a hash-locked requirements file) must be kept.

## Decision

Add a script install path for Windows. It downloads a prebuilt, unpacked app zip from the GitHub Release, verifies
it, and installs everything per user with no admin rights. The NSIS installer stays as an optional secondary
download; it is not changed by this work.

macOS, Linux, SignPath signing and in-app auto-update are out of scope.

## Release artifacts (CI)

In `build-os-artifacts.yml` the Windows job additionally:

1. Zips `dist/win-unpacked` as `DataLad-Desktop-<version>-win-x64.zip`.
2. Computes its SHA-256 and renders `install.ps1` from `scripts/windows/install.ps1`, replacing the
   `__VERSION__` and `__ZIP_SHA256__` placeholders.
3. Uploads the zip, `install.cmd` and the rendered `install.ps1`.

The publish job's `SHA256SUMS.txt` also covers the zip, `install.cmd` and `install.ps1`. The NSIS `.exe` and portable
`.exe` are built and published as before.

## `install.cmd`

A thin wrapper, as in prism-studio: `cd /d "%~dp0"`, unblock the downloaded files (`Unblock-File`), then
`powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 %*`, and pause on failure. No parenthesised
blocks and no `goto`, so it survives Unix line endings.

## `install.ps1`

Target folder: `%LOCALAPPDATA%\DataLad Desktop`. App settings and project data live in `app.getPath('userData')`
(under `%APPDATA%`), so an install or upgrade never touches them.

Steps:

1. **App.** Download the zip for this script's version (`__VERSION__`) and refuse to continue unless its SHA-256
   equals `__ZIP_SHA256__`. Extract to a temporary folder next to the target.
2. **DataLad.** From inside the verified zip, `resources\uv\uv.exe` creates a private environment on its own
   checksum-verified Python 3.12 (`uv venv --managed-python --python 3.12`) and installs
   `resources\datalad-requirements.txt` (hash-locked, wheels only). No system Python is ever run.
3. **Git.** If `git` is not found on PATH, download the pinned Git for Windows installer, verify its SHA-256, and run it
   per user (`/CURRENTUSER`). If that cannot work without admin, print what to do and continue.
4. **git-annex.** If `git-annex` is not found, download the pinned installer from DataLad's mirror
   (`https://datasets.datalad.org/datalad/packages/windows/git-annex-installer_<version>_x64.exe`, a versioned file,
   never `current`), verify its SHA-256 against the pin, then run it. Never an unpinned download.
5. **Shortcuts.** Start-menu and desktop shortcut to `DataLad Desktop.exe`.
6. **Log.** Append every step and every failing command's output to `install.log` in the target folder.

Rules (each has a test):

- No admin rights needed; no `-Verb RunAs`; the machine PATH is never written.
- Every downloaded file is hash-checked before it is run or extracted.
- A step that cannot finish (offline, hash mismatch) is logged with a clear message and does not leave a half-installed
  app: the previous install, if any, stays in place.
- The pins (git-annex version and hash, Git version and hash) sit together at the top of `install.ps1`.

Options: `-FromDir <folder>` uses a zip built in the same CI run instead of downloading one (the CI install test and
local testing need this). The expected hash is still checked.

## Upgrade

Running a newer release's `install.cmd`: stop and ask the user to close the app if it runs; extract to a temporary
folder; rename the old install to `.old`; move the new one into place; rebuild the DataLad environment from the new
lock file; delete `.old` only once the new install starts (`datalad --version` works). If any step fails, restore
`.old`. Git and git-annex are left alone when already present.

## Uninstall

`uninstall.cmd` is copied into the install folder. It removes the install folder and the shortcuts. It never removes
Python, Git or git-annex (other software may use them), and there is no PATH entry to remove.

## Testing

Tests first, run with `npm test` (Node test runner), in the style of `test/windows-installer.test.js`:

1. Text-level tests, one per rule above: no `RunAs`, no machine-PATH write, a SHA-256 check before every download is
   used, `install.cmd` has no parenthesised blocks, the git-annex URL is a versioned mirror URL and never `current`,
   the install folder is under `LOCALAPPDATA`, uninstall never removes Python, Git or git-annex.
2. Pin freshness: adapt the check in `installer-smoke.yml` so CI fails when the pinned git-annex or Git hash no longer
   matches the file at its URL, and reports when a newer git-annex version exists on the mirror.
3. A CI job on `windows-latest` runs `install.cmd -FromDir` with a zip built in the same run, then checks that
   `datalad --version` works from the install folder and the packaged app starts (reusing
   `e2e/packaged.e2e.mjs`).
4. The Windows ARM64 VM runs the same script by hand (x64 under emulation).

## Open points

- The git-annex pin starts at the newest version on DataLad's mirror at implementation time. Its hash is computed by
  us, because the mirror publishes none; that the mirror's file equals the author's signed build has not been checked.
- Git for Windows may need elevation for a per-user install on some machines. The script then prints instructions
  instead of failing silently; the exact behaviour is settled during implementation.
- The Git and git-annex pins exist twice during the transition (`installer.nsh` and `install.ps1`). The freshness check
  covers both.
