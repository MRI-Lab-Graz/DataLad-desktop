# Changelog

Summarized from git history. Tags: v0.2.1, v0.3.0, v0.4.0.

## Unreleased: science workflow

Six additions for the normal cycle of collect, analyse, save, share and publish. The app stays a small, curated tool: anything else is still one terminal command away.

- **Free Up Space:** removes the local copy of downloaded data, only when another copy is confirmed (it never forces; DataLad's own check cannot be lowered by a dataset's settings). Get Data brings it back.
- **Versions:** *Mark As Version* in Time Machine gives a save point a permanent name to cite in a paper; version chips show in the history. Publish also sends the versions you marked (not tags that came from collaborators).
- **Check Data Integrity:** re-checks every downloaded file against its recorded checksum and lists damaged ones.
- **Recorded runs:** commits made by `datalad run` show a "recorded run" chip and, in Time Machine, the command, its inputs and outputs. Display only: nothing is re-run.
- **Progress:** the running strip shows "N of M files" for Get Data and Publish.
- **Add a Remote:** one flow for a second copy on a USB drive or network share (a new folder of its own), or an empty repository on GIN, GitHub or GitLab. It connects, publishes everything and makes the remote the branch's upstream.
- **Security** (see `SECURITY.md`): Add a Remote with a local path is trust-checked; remotes and versions are named, never paths or URLs; the `ext::` transport is off; URL passwords and tokens are hidden and refused in Add a Remote; a backup folder cannot be a whole drive or the home folder. A test now derives which commands write to a remote and fails if one escapes the trust re-check.
- Fixed: a version or remote name ending in a dot, a relative or unreadable backup folder, a half-made backup folder that blocked a retry, and the Stop button not covering the version push.

## Unreleased: security hardening

Result of an independent security review (see `SECURITY.md` for what is protected and what is not).

- **Windows:** `git`/`datalad` are resolved to absolute paths from absolute `PATH` entries, so a program of the same name inside a dataset is never run.
- Every child process gets literal pathspecs (a file named `*` can no longer widen Discard/Restore) and `core.fsmonitor` forced off.
- **Folder trust:** opening a folder whose git config or hooks can run programs now asks first.
- **Trust before run:** a folder or local-path remote the app did not create runs nothing repository-controlled until you confirm it (native prompt: this folder, or everything inside it) or an administrator lists it in `trustedRoots`; a clone and Create Project over an existing folder always ask; the scanner is advice and change detection, not the gate. Existing trust records are kept; every other folder asks once.
- **Review round 4:** a push to a local-path remote runs that remote's own git hooks and config (git clears the app's environment overrides for the process it starts there), so a local remote is now judged like a repository you open: config allowlist plus every hook, except git-annex's exact stock hooks; `file://` URLs are read the way git reads them.
- **Review round 3:** git-annex's own hooks are checked by name in every place it can run them (work tree git dir, shared git dir, and the git dir of every local-path remote, again right before a push), and anything unreadable is a finding; git only uses repositories found as `.git`; create/clone targets and every text field must be text; a symlinked last path component no longer skips the location confirmation; included config files are judged; the trust dialog strips control characters.
- **Execution layer:** every git command uses only the stock git-annex hooks (a repository's own hooks never run; the app no longer runs your own hooks), and datalad ignores a dataset's reckless-clone setting.
- **Folder trust (reworked):** every nested repository is scanned (including ones missing from `.gitmodules` and deeper than three levels), annex/remote/datalad settings are matched against an exact allowlist, hitting a limit is reported as "not fully scanned", trust is remembered per finding and every open re-scans. The console and creating/cloning outside opened folders need a native confirmation. Minor: symlinked `info/exclude` is refused, `taskkill` is started by absolute path, the Program Files check matches a whole folder name.
- **Dataset procedures:** datalad never runs procedures a dataset ships in `.datalad/procedures` (adopting an existing BIDS dataset via Create Project used to run its `cfg_text2git`); folder trust reports them too.
- **Windows installer:** the DataLad environment is built by the bundled uv on its own Python; an existing system Python is never run with admin rights.
- Clone sources starting with `-` or using `ext::` are refused; branch checkout ends with `--`; `.gitignore` handlers confine their paths and refuse symlinks.
- Packaged builds no longer authorize the launch directory (it was `/` for apps started from Finder); only the app's own page can call IPC handlers; DevTools are off; the CSP forbids frames.
- Electron fuses locked (no run-as-node, `NODE_OPTIONS`, `--inspect`; ASAR integrity on); minimal macOS entitlements; only runtime sources are packaged.
- Windows installer: DataLad installs into a private, hash-locked environment; git-annex download is hash-verified; PowerShell by absolute path; no user-controlled `PATH`. Uninstall removes that environment instead of running `pip uninstall`.
- PRISM validator installs from a hash-locked, wheels-only requirements file (now pinned to 1.19.1) with uv config discovery off.
- Administrators can remove the command console (`DATALAD_DESKTOP_DISABLE_CONSOLE=1` or a system-level `policy.json`); the console's working directory is confined.
- Commands printing more than 256 MiB are stopped.
- CI/release: actions pinned by SHA, read-only default token, scoped signing secrets, releases labelled unsigned until a certificate exists, with `SHA256SUMS.txt` and a provenance attestation, verified gitleaks download, green `npm audit` gate.
- **Removed:** the duplicate GitLab release pipeline, the optional Rust adapter and the adapter-contract plumbing (Technical Details tab), the stale `latest.yml`/`builder-debug.yml`, a duplicate `escapeHtml`, and ~200 lines of unrelated `.gitignore`.

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
