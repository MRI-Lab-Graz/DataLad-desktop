# Changelog

Summarized from git history. Tags: v0.2.1, v0.3.0, v0.4.0.

## Unreleased: security hardening

Result of an independent security review (see `SECURITY.md` for what is protected and what is not).

- **Windows:** `git`/`datalad` are resolved to absolute paths from absolute `PATH` entries, so a program of the same name inside a dataset is never run.
- Every child process gets literal pathspecs (a file named `*` can no longer widen Discard/Restore) and `core.fsmonitor` forced off.
- **Folder trust:** opening a folder whose git config or hooks can run programs now asks first.
- Clone sources starting with `-` or using `ext::` are refused; branch checkout ends with `--`; `.gitignore` handlers confine their paths and refuse symlinks.
- Packaged builds no longer authorize the launch directory (it was `/` for apps started from Finder); only the app's own page can call IPC handlers; DevTools are off; the CSP forbids frames.
- Electron fuses locked (no run-as-node, `NODE_OPTIONS`, `--inspect`; ASAR integrity on); minimal macOS entitlements; only runtime sources are packaged.
- Windows installer: DataLad installs into a private, hash-locked environment; git-annex download is hash-verified; PowerShell by absolute path; no user-controlled `PATH`. Uninstall removes that environment instead of running `pip uninstall`.
- PRISM validator installs from a hash-locked, wheels-only requirements file (now pinned to 1.19.1) with uv config discovery off.
- Administrators can remove the command console (`DATALAD_DESKTOP_DISABLE_CONSOLE=1` or `resources/policy.json`); the console's working directory is confined.
- Commands printing more than 256 MiB are stopped.
- CI/release: actions pinned by SHA, read-only default token, scoped signing secrets, release tags require signing, `SHA256SUMS.txt` and provenance attestation, verified gitleaks download, green `npm audit` gate.
- **Removed:** the optional Rust adapter and the adapter-contract plumbing (Technical Details tab), the stale `latest.yml`/`builder-debug.yml`, a duplicate `escapeHtml`, and ~200 lines of unrelated `.gitignore`.

## 0.4.0

- **Git identity:** the app asks for your name and email on first launch (stored in the global git config), blocks Save, Create Project and Update until they are set, and lets you change them under Setup → Your Name and Email.
- Cancel long-running commands, with live activity shown while they run.
- Files tab lists one folder at a time and loads folders on expand; browsing no longer initializes git-annex in plain git repos (fixes a racy Get Data state).
- Windows installer: verifies the Git download, adds DataLad's Scripts folder to PATH, clearer diagnostics for silent failures.
- **Breaking:** removed the SSH / studies-server integration (server settings, studies listing, SSH password dialog, `createSibling`, studies-server publish). Network shares are used as plain folders instead.
- Security: bumped transitive dev dependencies to clear high-severity `npm audit` findings.
- Refactor: removed dead code (`src/index.js` barrel, unused stubs, duplicate spawn wrapper).
- Project header is set only after project type detection, avoiding spurious "unauthorized" errors.
- Security: `runCommand`, `listDatasets` and `ignoreOsNoiseFiles` are confined to authorized project folders (symlinks resolved).
- Added SECURITY.md.

## 0.2.x – 0.3.0

- Studies-server integration (since removed): remote studies listing, `createSibling`, SSH password management.
- Disconnect remote, unlock, BIDS auto-nesting, global busy overlay, repository lock recovery.
- Time Machine: per-file restore and discard of unsaved changes.
- OS noise files (e.g. `.DS_Store`) excluded from datasets.
- Linux builds; macOS hardened runtime plus opt-in signing/notarization.
- Console gating and filesystem path confinement enforced in the main process.

## 0.1.x

- Adapter hardening: `.gitmodules` path-traversal filter, flag-injection guards, recursive subdataset handling.
- MIT license added.
- Initial Electron GUI, Time Machine (commit browsing, branch-from-here), save/update/publish workflow, optional Rust adapter.
