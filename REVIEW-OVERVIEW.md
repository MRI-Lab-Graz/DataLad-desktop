# DataLad Desktop: technical overview for review

Repository: https://github.com/MRI-Lab-Graz/DataLad-desktop (branch `main`)

Written for: an experienced IT/security reviewer assessing fitness for non-technical users, mostly on Windows.

## What it is

Electron GUI over `git`, `git-annex` and `datalad` (save, update, publish, history browsing, restore). Local-first: no telemetry, no backend of its own, and no SSH credential handling (shared data lives on department network shares, used as plain folders/remotes). All process execution goes through a single adapter (`src/datalad/adapter.js`, `process-runner.js`); an optional Rust adapter (`rust-core/`, `DATALAD_DESKTOP_USE_RUST_ADAPTER`) is off by default.

## Trust boundaries

```
renderer (sandboxed, CSP)  --IPC (preload.js, contextBridge)-->  main process  --spawn(argv)-->  git / git-annex / datalad
                                                                      |
                                                                      +--> fs (confined to authorizedRoots), shell.openExternal
```

The renderer is treated as the untrusted side. `src/gui/main.js` registers 27 `ipcMain.handle` channels; `src/gui/preload.js` is the only surface exposed to the page.

## Controls, with where to verify

**Renderer / Electron**
- `webPreferences`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (`createMainWindow`, `main.js`).
- CSP in `src/gui/renderer/index.html`: `default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; connect-src 'self'`. No inline script. `style-src` allows `'unsafe-inline'`.
- Navigation: `setWindowOpenHandler` always denies; `will-navigate` blocks anything but the app URL. http(s) links go to `shell.openExternal`.
- Output escaping: `escapeHtml` (`renderer/app.js`) is used when building markup. There are 47 `innerHTML` assignments in `app.js`; this is where an XSS would be found, so it is the first place to review.

**Process execution**
- Dataset operations: `spawn(command, argsArray, …)` with `shell: false` (`process-runner.js`). No string concatenation into a shell.
- Request validation: `assertCommandRequest` in `src/datalad/schema.js` checks required fields, `paths` shape, and rejects leading `-` in branch/remote/procedure fields. Commit messages go as `--message=<value>`.
- `.gitmodules` subdataset paths are filtered by `isSafeRelativeSubdatasetPath` (rejects absolute and `..`), in both JS and Rust adapters, with a regression test. This was a real finding from an earlier audit.

**Filesystem confinement**
- `authorizedRoots` = launch cwd + folders picked in the native dialog + paths that passed `detectProject` or were created by clone/create. `requireAuthorizedRoot` / `isWithinAuthorizedRoot` resolve real paths before the prefix match.
- Enforced on `fs:*` and all `adapter:*`/`watch:*` handlers except the two exceptions below; `src/gui/path-confinement.js` compares real paths so symlinks cannot escape a root. Tested in `test/path-confinement.test.js` and, in real Electron, `e2e/path-confinement.e2e.mjs`.

**Command console (power-user terminal)**
- Off by default. `console:runCommand` throws unless the main-process flag `consoleEnabled` is set. `e2e/console-gate.e2e.mjs` shows a direct IPC call is refused (verified to fail when the check is removed).
- macOS/Linux: input is tokenized and run with `shell: false`. Windows: the line is passed to `cmd.exe` (`shell: true`) so `.cmd` shims resolve; shell operators therefore work on Windows.

**CI and hygiene**
- Workflows: tests + coverage gate (`test-coverage.yml`, thresholds 85/85/75 on `src/datalad/**`), gitleaks (`security-checks.yml`), cross-platform and Windows installer smoke builds, release builds (`build-os-artifacts.yml`).
- `npm audit --omit=dev`: 0 vulnerabilities. Tests: `npm test` 285 passing; `npm run test:e2e` 33 passing, 0 failing, 2 skipped.
- Reports in repo: `SECURITY.md`, `CHANGELOG.md`.

## Limitations we found ourselves (please push on these)

1. **Console toggle is renderer-settable.** `console:setEnabled` is an IPC call, so the gate protects against UI bypass and bugs, not against a compromised renderer: script injection could enable the console and then run commands. The defences against injection are the CSP and output escaping above, hence the `innerHTML` review.
2. **Path confinement exceptions.** `adapter:inspectBidsCandidate` (read-only probe of a typed folder; returns only BIDS marker names) and the clone/create target path (does not exist yet; authorized after success) are deliberately outside `requireAuthorizedRoot`. Confinement compares real paths (symlinks resolved), but Windows case-insensitivity and junction points are not specifically tested.
3. **Windows installer supply chain** (`build/installer.nsh`, NSIS, needs admin): Git for Windows and Python 3.12 are downloaded at pinned versions and SHA-256 verified before running. The git-annex installer is fetched from a "current" URL with no hash check, and `pip install --upgrade datalad` is unpinned. Failures are logged and skipped, not fatal.
4. **Signing.** Windows installers are unsigned (SmartScreen warning on first run); SignPath is wired into CI behind `SIGNPATH_ENABLED`. macOS signing/notarization is wired behind `MACOS_SIGNING_ENABLED` but needs Apple credentials.
5. No auto-update. Rust adapter has weaker parity testing. Two e2e tests are skipped.
