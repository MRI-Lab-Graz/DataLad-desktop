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
- Every child runs git with `core.hooksPath` pointed at an app-owned folder that holds only the stock git-annex hooks (`build/git-hooks`, shipped as `resources/git-hooks`). A repository's own hooks, whether in the folder you open or in a nested repository, never run. The shipped hooks do nothing in a repository without a git-annex uuid, so plain git projects still commit. This means the app does not run hooks you wrote yourself in projects it manages (`src/datalad/process-runner.js`, `test/process-runner.test.js`).
- Every child gets `DATALAD_CLONE_RECKLESS` set empty, so a dataset's committed `.datalad/config` cannot choose a reckless clone mode such as `shared-0777` (which would make every cloned subdataset's `.git` writable by all local users).
- Every child also gets `DATALAD_LOCATIONS_DATASET__PROCEDURES` pointing at a file, so datalad never runs procedures a dataset ships in `.datalad/procedures` (datalad would otherwise prefer them over its own, e.g. for `create -c text2git`; `test/process-runner.test.js` reproduces this with a real dataset).
- Requests are schema-checked (`src/datalad/schema.js`). Branch, remote and clone-source fields cannot start with `-`; the `ext::` transport is refused; paths follow `--`; commit messages go as `--message=<value>`.
- A command that prints more than 256 MiB is stopped.

**Folder trust (trust before run)**
- The rule: a folder or a local-path remote the app did not create itself runs nothing that repository content can influence until it is trusted. A folder is trusted when you confirmed it in the prompt, when an administrator listed a location containing it, or when the app created it as a new project in an empty or missing folder. A clone, and Create Project over an existing folder, always ask. A folder becomes a project root (what every file, git and console handler requires) only through one gate, so "project root" implies "trusted" (`src/gui/trust-gate.js`, `test/trust-wiring.test.js`).
- The prompt is a native dialog with three buttons: Cancel (the default), Trust this folder, and Trust everything inside this folder (for a lab share root; anything added there later is trusted too, as the button says). It shows the path and what the scan found, as advice: "nothing unusual found" does not mean safe.
- Administrators can pre-trust locations with `trustedRoots` (a list of absolute paths) in the same `policy.json` as `consoleDisabled`; folders inside one need no prompt. A policy file that cannot be parsed adds no trusted roots (`src/gui/policy.js`, `test/policy.test.js`).
- What you trusted is stored in `trusted-folders.json` in the app's data folder (`src/gui/trust-store.js`). Trusting "this folder" keeps the findings you saw and the folder's identity (inode and creation time), so a new or changed finding, or a different folder at the same path (another USB stick, a re-extracted archive), asks again. Delete the file or an entry to forget trust. Where the filesystem gives no usable inode the identity check is skipped.
- Before a push, the project and every local-path remote are checked again (a share can change in between); a remote is asked about per path, with the same three buttons.
- Which remotes a push uses is read the way git and git-annex read them: `url`, `pushurl` (with `insteadOf` rewrites) and `annexUrl` (git-annex pushes there when it is set), relative URLs resolved from the work tree root even when the project path is a subfolder. A remote URL that cannot be read with certainty (a control character such as a newline, an unreadable value) refuses the push instead of being skipped.
- Nesting a folder into a project ("Convert into nested dataset", `createSubdataset`) re-runs the gate on the project first, because the folder may have been copied in after the project was trusted; a new finding there asks again.
- A folder picked as a clone source is only read from: it is not offered for trust and not made a project root. Cloning from a hostile local source ran none of its hooks or settings in the review (`test/trust-wiring.test.js`).
- The path in the prompt is shown resolved, with control and bidi characters removed and a length cap, so a folder name cannot reorder or hide what the prompt says.
- The scan below does not decide anything. It is the advice in the prompt and the detector for later changes.
- Hooks are neutralised where commands run (above), so folder trust covers what cannot be switched off: filter drivers (git-annex needs its own), git and git-annex settings, and datalad dataset settings.
- Before the app runs git in a folder it has not created itself, it finds every repository under it (a walk of the folder tree, plus every gitlink in each repository's index, with no depth limit) and checks each repository's config against an exact allowlist of the keys git, git-annex and datalad write themselves; anything else is reported, because new option families that run programs keep appearing. The stock git-annex filter is recognised exactly. Procedures a dataset ships (`.datalad/procedures`) and `datalad.procedures.*`, `datalad.locations.*`, `datalad.clone.*` and `datalad.get.*` in the committed `.datalad/config` are reported too (`src/gui/folder-trust.js`, `test/folder-trust.test.js`).
- git-annex runs hooks of its own (`pre-commit-annex`, `post-update-annex`, `freezecontent-annex`, `thawcontent-annex`, `secure-erase-annex`, `commitmessage-annex`, `http-headers-annex`, `pre-init-annex`, and anything else with `annex` in its name) from `<git dir>/hooks` and ignores `core.hooksPath`, so they are looked for by name in every place git-annex can run them: the work tree's own git directory (a linked worktree has its own), the shared git directory, and the git directory of every local-path remote (an absolute path, `file://`, a relative path, or an `insteadOf` rewrite to one; a share or USB stick). Remote locations are checked when you open a folder and again right before a push, because a share can change in between. A push to a local path also runs the *remote's* own git hooks (`pre-receive`, `update`, `post-receive`, `post-update`, `reference-transaction`, `push-to-checkout`, ...) and uses the remote's own config, and the app's environment overrides do not reach there (git clears `GIT_CONFIG_COUNT` for the process it starts on a local path). So a local remote is judged like a repository you open: its config goes through the same allowlist and every hook in its hooks folder is reported, except the stock git-annex hooks (exact content, under their own names), which a datalad-made share carries. `file://` URLs are read the way git reads them (host dropped, `%`-escapes decoded, `?` and `#` part of the path). Expect one prompt per share that carries its own hooks or settings; the fingerprint is stable, so the answer is remembered. They are reported with a fingerprint of the whole hook, so a changed hook is a new finding. A hooks folder or hook the app cannot read is reported as "not fully scanned", never skipped. Nested repositories are found by asking the filesystem (a folder named `.GIT` counts on macOS and Windows).
- Every child runs git with `safe.bareRepository=explicit`, so git only uses a repository it finds as `.git`: a folder that merely looks like a bare git directory cannot name a work tree elsewhere and bring its own filters. Pushing to and cloning from bare remotes is unaffected (`test/process-runner.test.js`); a bare repository used as the current directory (for example a RIA store opened with `-C`) is refused by the app's git.
- If the scan hits its limit (200 repositories, 200,000 files and folders) it reports "not fully scanned" instead of passing silently. That one finding is accepted for the current launch only, never remembered, and the dialog always lists it first.
- A folder you trusted as "this folder" is re-scanned on every open: a finding that was not there when you said yes, or whose command changed, asks again.

**Filesystem confinement**
- Renderer-supplied paths must lie inside an authorized root: a folder you opened, picked in the native dialog, or that the app created or cloned. Real paths are compared, so symlinks at the top level cannot escape (`src/gui/path-confinement.js`, `e2e/path-confinement.e2e.mjs`). The launch directory is authorized only in development, not in packaged builds. Creating or cloning a project into a folder outside every opened folder needs a native confirmation dialog.
- Subdataset paths from `.gitmodules` must be relative and free of `..`. Dataset paths given to the `.gitignore` handlers get the same check, and a `.gitignore` that is a symlink is refused.

**Command console**
- Off by default; enforced in the main process, not just the UI (`e2e/console-gate.e2e.mjs`). Turning it on needs a native confirmation dialog from the main process, remembered in a file only the main process writes, so a compromised page cannot switch it on (`src/gui/console-consent.js`). The working directory must be an authorized root. The administrator policy below remains the hard control.
- **Administrators can remove it entirely**: set the environment variable `DATALAD_DESKTOP_DISABLE_CONSOLE=1`, or create a `policy.json` containing `{"consoleDisabled": true}` in an administrator-only system folder that updates do not touch: `%ProgramData%\DataLad Desktop\` on Windows, `/Library/Application Support/DataLad Desktop/` on macOS, `/etc/datalad-desktop/` on Linux (a `policy.json` in the app's `resources` folder is honoured too, but an update replaces that folder). A `policy.json` that cannot be parsed also disables the console (`src/gui/policy.js`, `e2e/console-policy.e2e.mjs`).
- On Windows the line is handed to `cmd.exe` so `.cmd` shims work; shell operators therefore work there. On macOS and Linux it is tokenized and run without a shell.

**Managed Python environment (PRISM validator)**
- Installed from `build/prism-requirements.txt` with `--require-hashes --only-binary :all:`, an explicit index, and uv's config discovery turned off. The bundled `uv` is pinned and SHA-256 verified at build time (`scripts/fetch-uv.mjs`).

**Windows installer** (`build/installer.nsh`, runs elevated)
- Git, Python and git-annex are downloaded into a random per-run folder and SHA-256 verified before they run. DataLad is installed into a private environment under the install folder from the hash-locked `build/datalad-requirements.txt` by the bundled `uv`, on uv's own checksum-verified Python 3.12 (also under the install folder). An existing system Python is only looked up, never run, because the installer runs elevated; if there is none, the pinned python.org installer runs so the app's environment check finds one. Only that environment's `Scripts` folder is added to the machine `PATH`. PowerShell is called by absolute path and tools are looked up on the machine `PATH` only. Uninstalling deletes the private environment and its `PATH` entry; Python, Git and git-annex are left alone.

**Build and release** (`.github/workflows/`)
- Every action is pinned to a commit SHA; workflows default to a read-only token; signing secrets go only to the signing step; the gitleaks download is checksum-verified (`test/workflow-security.test.js`).
- Releases are **currently unsigned** (no certificate yet); the release notes say so for each platform. Instead, every release publishes `SHA256SUMS.txt` and a build provenance attestation that ties each file to the commit and workflow that built it. Verify a download with `sha256sum -c SHA256SUMS.txt --ignore-missing` and `gh attestation verify <file> --repo <owner/repo>`. Signing turns on by setting `MACOS_SIGNING_ENABLED` / `SIGNPATH_ENABLED` and the matching secrets; nothing else changes.
- Checks on pushes to `main` and pull requests: unit and e2e tests with a coverage gate, gitleaks, and `npm audit` (`tests/npm-audit.sh`).

**Recommended for institutional deployment**
- Ship the system-level `policy.json` with `{"consoleDisabled": true}` (see Command console above), and install under Program Files.

## Known limitations

- **Folder trust is a prompt, not a sandbox.** If you trust a folder, git runs what its config says (filters, ssh commands). Hooks never run, but the app does not run your own hooks either.
- **Another person who can write to a folder or share you trusted can change hooks and settings afterwards.** The control for that is the share's own permissions: only people you trust may write to the datasets and their `.git` folders. Git author names and emails cannot be used instead (they are self-declared, and the files that run code carry no author or signature). Only a sandbox closes this fully. A check of file ownership and permissions (trusted only while owned by you or a listed account and not writable by group or others; macOS and Linux first, Windows needs its own decision) is planned for a later version.
- **No code signing yet.** Windows shows a SmartScreen warning and macOS a Gatekeeper warning until a certificate is bought (Windows signing goes through SignPath; macOS needs Apple credentials). Until then, integrity rests on the checksum and the provenance attestation above, and on downloading from this repository's releases only.
- **The Windows installer has not been run by the author on Windows.** The installer smoke workflow (`.github/workflows/installer-smoke.yml`) is the check; run it before a rollout. Likewise the planted-`datalad.exe` protection rests on code review of libuv's search order plus the absolute-path resolution, not on a Windows test.
- **git-annex has no versioned download URL.** The installer pins the hash of the current release, so when upstream publishes a new version the hash check fails and git-annex is skipped (and logged) until the pin in `build/installer.nsh` is bumped.
- **A custom install folder chosen by an administrator.** The DataLad `Scripts` folder is only added to the machine `PATH` when the install is under Program Files; on a data drive (often writable by every user) it is skipped and logged, because a machine-wide `PATH` entry there would let any user plant programs.
- **Dataset contents are still data you open.** git-annex special remotes of type `external` run a `git-annex-remote-*` program found on `PATH`, and a hostile dataset may name one.
- **The PRISM Save gate is a data-quality check, not a security control.** It runs on the client and can be bypassed with a terminal or the console.
- **Some residual gaps.** A time-of-check/time-of-use window exists between the path check and git running (exploiting it needs write access to the project). A symlink committed at a registered subdataset path is followed. `adapter:detectProject` authorizes any git work tree a (compromised) renderer names; `adapter:inspectBidsCandidate` probes any folder and returns only BIDS marker names. The `npm audit` gate allowlists two dev-only advisories with written justification (`tests/npm-audit.sh`).
- No auto-update; users install new releases manually.
- Code in this repository is developed with AI assistance. Changes are validated by the test suite, CI, and human review of the diff.
