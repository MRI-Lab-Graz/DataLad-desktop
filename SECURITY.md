# Security

## Reporting a vulnerability

Please report vulnerabilities privately (GitHub Security Advisories on this repo, or email the maintainer) rather than opening a public issue.

## Threat model

DataLad Desktop is a local GUI over `git`, `git-annex` and `datalad`. It has no telemetry and no server component. The people we defend against:

- **A malicious dataset, folder or remote.** Anything inside a dataset (file names, commit messages, branch names, `.gitmodules`, `.git/config`, hooks) is attacker-controlled.
- **A local unprivileged user** on a shared or managed machine.
- **A compromised dependency or build pipeline.**

The app is not offline-only. It talks to the network in these cases, and only these:

- `git`, `git-annex` and `datalad` contact the remotes you choose (clone, update, push).
- The PRISM validator environment is installed on first use through the bundled `uv`, from PyPI (hash-locked, see below). `uv` may also download a Python build from GitHub.
- The Windows installer downloads Git for Windows, Python 3.12, git-annex and the DataLad packages (every download hash-checked or hash-locked).

## Controls

Each control below has a test; the file names are where to verify it.

**Electron**
- `contextIsolation`, `sandbox`, no `nodeIntegration`; all permission requests and checks are denied; webviews, `window.open` and navigation away from the app are blocked; DevTools are disabled in packaged builds (`src/gui/main.js`).
- Strict CSP in a meta tag, with no inline script, no `eval`, no frames or plugins (`src/gui/renderer/index.html`, `test/renderer-csp.test.js`). The page loads from `file://`, so the CSP's `'self'` covers the app's own files only because navigation and frames are also blocked.
- Only the app's own top-level page may call an IPC handler (`src/gui/ipc-guard.js`).
- The preload script exposes one named function per channel, never `ipcRenderer` itself.
- All untrusted text reaches the DOM through one escaping routine (`src/gui/renderer/escape-html.js`).
- Electron fuses are locked in packaged builds: no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no `--inspect`, ASAR integrity on, load only from the ASAR (`package.json`, `test/packaging-config.test.js`). The macOS entitlements are minimal; library validation stays on (`build/entitlements.mac.plist`).

**Running programs**
- `git`/`datalad` are started with an argument array, never through a shell, after resolving them to an absolute path from absolute `PATH` entries only. A program with the same name inside a dataset folder is never run, and children get `NoDefaultCurrentDirectoryInExePath=1` (`src/datalad/resolve-tool.js`, `src/datalad/process-runner.js`).
- Every child runs with `GIT_LITERAL_PATHSPECS=1` (a file named `*` is just a file) and with `core.fsmonitor` forced off, so a repository's own config cannot make `git status` run a program.
- Requests are schema-checked (`src/datalad/schema.js`). Branch, remote and clone-source fields cannot start with `-`; the `ext::` transport is refused; paths follow `--`; commit messages go as `--message=<value>`.
- A command that prints more than 256 MiB is stopped.

**Folder trust**
- Before the app runs git in a folder it has not created or cloned itself, it looks for settings that make git run programs (hooks, `core.sshCommand`, filter and diff drivers, `!` aliases, credential helpers, `include`). The stock git-annex hooks and filter are recognised exactly; anything else makes the app ask once and remember your answer (`src/gui/folder-trust.js`, `test/folder-trust.test.js`).

**Filesystem confinement**
- Renderer-supplied paths must lie inside an authorized root: a folder you opened, picked in the native dialog, or that the app created or cloned. Real paths are compared, so symlinks at the top level cannot escape (`src/gui/path-confinement.js`, `e2e/path-confinement.e2e.mjs`). The launch directory is authorized only in development, not in packaged builds.
- Subdataset paths from `.gitmodules` must be relative and free of `..`. Dataset paths given to the `.gitignore` handlers get the same check, and a `.gitignore` that is a symlink is refused.

**Command console**
- Off by default; enforced in the main process, not just the UI (`e2e/console-gate.e2e.mjs`). The working directory must be an authorized root.
- **Administrators can remove it entirely**: set the environment variable `DATALAD_DESKTOP_DISABLE_CONSOLE=1`, or create a `policy.json` containing `{"consoleDisabled": true}` in an administrator-only system folder that updates do not touch: `%ProgramData%\DataLad Desktop\` on Windows, `/Library/Application Support/DataLad Desktop/` on macOS, `/etc/datalad-desktop/` on Linux (a `policy.json` in the app's `resources` folder is honoured too, but an update replaces that folder). A `policy.json` that cannot be parsed also disables the console (`src/gui/policy.js`, `e2e/console-policy.e2e.mjs`).
- On Windows the line is handed to `cmd.exe` so `.cmd` shims work; shell operators therefore work there. On macOS and Linux it is tokenized and run without a shell.

**Managed Python environment (PRISM validator)**
- Installed from `build/prism-requirements.txt` with `--require-hashes --only-binary :all:`, an explicit index, and uv's config discovery turned off. The bundled `uv` is pinned and SHA-256 verified at build time (`scripts/fetch-uv.mjs`).

**Windows installer** (`build/installer.nsh`, runs elevated)
- Git, Python and git-annex are downloaded into a random per-run folder and SHA-256 verified before they run. DataLad is installed into a private environment under the install folder from the hash-locked `build/datalad-requirements.txt`, never into a shared Python. Only that environment's `Scripts` folder is added to the machine `PATH`. PowerShell is called by absolute path and tools are looked up on the machine `PATH` only. Uninstalling deletes the private environment and its `PATH` entry; Python, Git and git-annex are left alone.

**Build and release** (`.github/workflows/`)
- Every action is pinned to a commit SHA; workflows default to a read-only token; signing secrets go only to the signing step; the gitleaks download is checksum-verified (`test/workflow-security.test.js`).
- A release tag **fails** unless macOS and Windows signing are configured. The release publishes `SHA256SUMS.txt` and a build provenance attestation.
- Checks on pushes to `main` and pull requests: unit and e2e tests with a coverage gate, gitleaks, and `npm audit` (`tests/npm-audit.sh`).

## Known limitations

- **Folder trust is a prompt, not a sandbox.** If you trust a folder, git runs what its config and hooks say.
- **Signed releases only exist once signing is configured.** Manual (`workflow_dispatch`) test builds can be unsigned. Windows signing goes through SignPath; macOS needs Apple credentials.
- **The Windows installer has not been run by the author on Windows.** The installer smoke workflow (`.github/workflows/installer-smoke.yml`) is the check; run it before a rollout. Likewise the planted-`datalad.exe` protection rests on code review of libuv's search order plus the absolute-path resolution, not on a Windows test.
- **git-annex has no versioned download URL.** The installer pins the hash of the current release, so when upstream publishes a new version the hash check fails and git-annex is skipped (and logged) until the pin in `build/installer.nsh` is bumped.
- **A custom install folder chosen by an administrator** must itself be admin-writable only, because the private DataLad environment lives there.
- **Dataset contents are still data you open.** git-annex special remotes of type `external` run a `git-annex-remote-*` program found on `PATH`, and a hostile dataset may name one.
- **The PRISM Save gate is a data-quality check, not a security control.** It runs on the client and can be bypassed with a terminal or the console.
- **Some residual gaps.** A time-of-check/time-of-use window exists between the path check and git running (exploiting it needs write access to the project). A symlink committed at a registered subdataset path is followed. `adapter:detectProject` authorizes any git work tree a (compromised) renderer names; `adapter:inspectBidsCandidate` probes any folder and returns only BIDS marker names. The `npm audit` gate allowlists two dev-only advisories with written justification (`tests/npm-audit.sh`).
- No auto-update; users install new releases manually.
- Code in this repository is developed with AI assistance. Changes are validated by the test suite, CI, and human review of the diff.
