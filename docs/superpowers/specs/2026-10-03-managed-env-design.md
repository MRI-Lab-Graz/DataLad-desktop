# Managed Python environment (validator only) — Design

Spec **B** of the PRISM-validator work. Later specs: **A** PRISM validator + Save gate (needs B),
B+DataLad migration, **C** git/git-annex binaries. Out of scope here: DataLad and git-annex in the
env, validator auto-update beyond the pin, offline installs.

## Goal

The app owns a private Python environment containing `prism-validator`, so researchers on any OS
need no Python, pip or Docker. Environment creation uses **uv**, bundled inside the installer.

## Decisions

- uv is **bundled** per OS/arch via electron-builder `extraResources` (not downloaded at runtime):
  no downloader/extractor, covered by the app's signing, no GitHub dependency at runtime. Cost:
  ~20–40 MB per installer. uv itself still needs the network on first use (Python + package).
- The env lives in `<userData>/env`. Python version and validator version are pinned constants in
  one block (`prism-validator==<pin>`); bumping the pin triggers a reinstall.
- Prerequisite owned by the PRISM team: `prism-validator` published to PyPI (404 today). Until
  then the real install fails with "not available yet"; everything else is tested against a fake uv.

## Components

New `src/datalad/managed-env.js`, depending on `ProcessRunner`; Electron paths are injected from
`main.js` so the module is testable without Electron.

- `resolveUv(baseDir, platform)` → `<baseDir>/uv/uv[.exe]` (each installer bundles only its own target's binary, so no platform/arch subfolder)
- `envBin(envDir, name)` → `Scripts/` (win32) or `bin/` path of an env executable
- `envStatus(envDir)` → `{ ready, validatorVersion }`; ready only if `prism-validator --version` runs
- `ensureEnv({ uvPath, envDir, pythonVersion, packages, signal, onOutput })` — idempotent:
  `uv venv --python <ver> <envDir>`, then `uv pip install --python <envDir> <pinned pkgs>`, then
  verify. Never leaves a half-built env: on failure, cancel, or interrupted earlier run it deletes
  the folder.

Integration: `main.js` IPC `env:ensure` (registered in the run registry → shows in "Running
commands" with Cancel) and `env:status`; a "PRISM validator" row in diagnostics/Setup with an
Install button (informational; spec A consumes `envBin`); CI step fetches the pinned uv release and
verifies its SHA-256 before packaging; Windows uninstaller removes `<userData>/env`; macOS/Linux
docs say "delete the folder".

## Failure handling

Plain-language message + raw stderr under "Technical details" (same pattern as `errors.js`):
offline/proxy-blocked, package not found (PyPI), disk full/permission denied, cancelled (kill tree,
delete partial env), interrupted install (next call wipes and retries), uv binary
blocked/quarantined (spawn error names the bundled path).

## Testing (TDD, red first)

A fake runner injected into `ensureEnv`/`envStatus` (same shape as `ProcessRunner`) records the uv
calls and creates the env folder, so tests are identical on every OS. (Windows uninstall uses
electron-builder's `deleteAppDataOnUninstall` instead of a custom NSIS step.)

- `resolveUv` per platform/arch; `envBin` Windows vs POSIX layouts
- `ensureEnv`: exact uv args/order; second call no-op; pin change reinstalls; failed install leaves
  no folder; abort signal kills child and cleans up
- `envStatus` ready only when the executable runs
- Packaging config: `extraResources` covers every build target; CI SHA-256 pin present
- Manual check on one real machine before B is called done (blocked on the PyPI release)
