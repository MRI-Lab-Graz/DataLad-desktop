# Security

## Reporting a vulnerability

Please report vulnerabilities privately (GitHub Security Advisories on this repo, or email the maintainer) rather than opening a public issue.

## Threat model

DataLad Desktop is a local, offline-by-default GUI over `git`, `git-annex` and `datalad`. It has no telemetry and no server component. Network access happens only through those tools (clone, update, push) against remotes or network shares the user chooses. There is no SSH credential handling in the app.

## Controls

- **Electron hardening:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict Content-Security-Policy (`src/gui/main.js`, `src/gui/renderer/index.html`).
- **No shell for dataset operations:** DataLad/git commands are run via `spawn` with an argument array and `shell: false`.
- **Input validation:** command requests are schema-checked (`src/datalad/schema.js`); branch names, remote names and similar fields may not start with `-`. Commit messages are passed as `--message=<value>`.
- **Path confinement:** subdataset paths read from `.gitmodules` must be relative and may not contain `..` (`isSafeRelativeSubdatasetPath`, with regression test). `fs:*` and most `adapter:*` IPC handlers confine renderer-supplied paths to authorized roots (`requireAuthorizedRoot` in `src/gui/main.js`). Not yet covered: `adapter:runCommand`, `adapter:listDatasets`, `adapter:ignoreOsNoiseFiles`, `adapter:inspectBidsCandidate`.
- **Power-user console:** runs arbitrary commands by design, so it is disabled by default and enforced in the main process (`console:runCommand` refuses while off), not just in the UI (this stops UI bypass and bugs; the toggle is itself set over IPC, so it is not a defence against a fully compromised renderer, which CSP and output escaping are meant to prevent), and covered by an e2e test (`e2e/console-gate.e2e.mjs`). On Windows the line is handed to `cmd.exe` (`shell: true`) so `.cmd` shims work; elsewhere it is tokenized and run without a shell.
- **CI:** unit/e2e tests with a coverage gate, gitleaks secret scanning on every push, `npm audit`.

## Known limitations

- macOS builds are signed/notarized only when the maintainer has configured Apple credentials (`MACOS_SIGNING_ENABLED`); otherwise Gatekeeper will warn.
- No auto-update mechanism; users install new releases manually.
- The optional Rust adapter (`DATALAD_DESKTOP_USE_RUST_ADAPTER`) is off by default and has less parity testing than the JS adapter.
- Code in this repository is developed with AI assistance. Changes are validated by the test suite, CI, and human review of the diff.
