# Changelog

Summarized from git history. Tags: v0.2.1, v0.3.0.

## Unreleased

- Removed the SSH / studies-server integration (server settings, studies listing, SSH password dialog, `createSibling`, studies-server publish). Network shares are used as plain folders instead.
- Security: bumped transitive dev dependencies to clear high-severity `npm audit` findings.
- Refactor: removed dead code (`src/index.js` barrel, unused stubs, duplicate spawn wrapper).
- Project header is set only after project type detection, avoiding spurious "unauthorized" errors.

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
