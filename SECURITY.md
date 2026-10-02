# Security

## Reporting a vulnerability

Please report vulnerabilities privately (GitHub Security Advisories on this repo, or email the maintainer) rather than opening a public issue.

## Threat model

DataLad Desktop is a local, offline-by-default GUI over `git`, `git-annex` and `datalad`. It has no telemetry and no server component. Network access happens only through those tools (clone, update, push) and the optional studies-server integration the user configures.

## Controls

- **Electron hardening:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict Content-Security-Policy (`src/gui/main.js`, `src/gui/renderer/index.html`).
- **No shell for dataset operations:** DataLad/git commands are run via `spawn` with an argument array and `shell: false`.
- **Input validation:** command requests are schema-checked (`src/datalad/schema.js`); branch names, remote names and similar fields may not start with `-`. Commit messages are passed as `--message=<value>`.
- **Path confinement:** subdataset paths read from `.gitmodules` must be relative and may not contain `..` (`isSafeRelativeSubdatasetPath`, with regression test). Filesystem access from the renderer is confined in the main process.
- **Power-user console:** runs arbitrary commands by design, so it is disabled by default and enforced in the main process (`console:runCommand` refuses while off), not just in the UI, and covered by an e2e test (`e2e/console-gate.e2e.mjs`). On Windows the line is handed to `cmd.exe` (`shell: true`) so `.cmd` shims work; elsewhere it is tokenized and run without a shell.
- **Confirmation before shared writes:** publishing to the shared studies server asks for explicit confirmation.
- **CI:** unit/e2e tests with a coverage gate, gitleaks secret scanning on every push, `npm audit`.

## Known limitations

- macOS builds are signed/notarized only when the maintainer has configured Apple credentials (`MACOS_SIGNING_ENABLED`); otherwise Gatekeeper will warn.
- No auto-update mechanism; users install new releases manually.
- The optional Rust adapter (`DATALAD_DESKTOP_USE_RUST_ADAPTER`) is off by default and has less parity testing than the JS adapter.
- Code in this repository is developed with AI assistance. Changes are validated by the test suite, CI, and human review of the diff.
