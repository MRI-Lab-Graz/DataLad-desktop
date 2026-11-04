# prism-validator auto-update and update notices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At start the app quietly updates an installed prism-validator to the newest safe release, and tells the user (with "Skip this version") when DataLad or git-annex have newer versions; nothing else is installed for them.

**Architecture:** A new main-process module `src/datalad/validator-update.js` asks PyPI for the newest release at least 3 days old, resolves a hash-locked requirement list with the bundled `uv`, builds the new environment beside the old one (`env.next`), proves it works (starts, and the Save check can read its report), then swaps directories. `src/datalad/tool-notices.js` compares installed and latest DataLad/git-annex versions and keeps "skipped" choices. `main.js` runs both after the window is shown (never blocking), the renderer shows a small notice strip.

**Tech Stack:** Node built-ins (`fetch`, `fs`, `node:test`), the bundled `uv` (`build/uv`), existing `ProcessRunner`. No new dependencies.

**Spec:** the design approved in chat on 2026-11-04 (summarised here; no separate document).

## Global Constraints

- Security is priority 1; fail closed. Windows is the main platform: use `node:path`, no shell strings, handle `EBUSY`/`EPERM` on rename.
- prism-validator auto-installs ONLY when it is already installed (a working `userData/env`); it never installs it for someone who never opted in.
- Release choice: newest stable release (no pre-release, no yanked file) whose upload time is at least `PRISM_COOLDOWN_DAYS = 3` days old; `uv pip compile` gets `--exclude-newer` set to the same cutoff so dependencies obey it too.
- Install rules unchanged from `ensureEnv`: `--no-config`, wheels only (`--only-binary :all:`), `--require-hashes`, `--no-deps`, Python `3.12` (`MANAGED_ENV.python`), from `https://pypi.org/simple`.
- Build in `env.next`, verify, then swap; if anything fails the current env is untouched and keeps working; a failed version is not retried until a newer version exists.
- Never swap while a Save/validation is running; defer to the next start.
- DataLad and git-annex are NEVER installed or changed by the app, only announced. Python is not touched.
- Admin switch: env var `DATALAD_DESKTOP_DISABLE_UPDATE_CHECK=1` or `updateCheckDisabled: true` in a policy file (an unreadable existing policy file also disables it, like `runDisabled`). When off: no network request at all.
- Offline or any lookup error is silent (no dialog); the next start tries again.
- Wording for students: plain, no jargon ("newer version", "update", not "wheel", "hash").
- TDD for every task; `npm test` stays fast; new UI follows the a11y rules (status role, keyboard reachable).

## Review Focus

- PyPI answers with garbage, a yanked newest release, only pre-releases, or an unreachable host: no change, no error dialog (T1, T4).
- A Save/validation is running when the swap is due: swap is deferred, validator files untouched (T4).
- The new env builds but fails the self-check or the Save-check compatibility test: old env stays, version remembered as failed (T4).
- Rename fails with `EBUSY`/`EPERM` (Windows file in use): old env restored, reported as "try again next start" (T4).
- The user later clicks Install under PRISM Validator: an auto-updated env must NOT be downgraded to the version pinned in the app (T3).
- Admin switch set or policy file unreadable: zero network requests (T2, T6).

---

### Task 1: Version logic

**Files:**
- Create: `src/datalad/validator-update.js` (this task adds the pure functions only)
- Test: `test/validator-update.test.js`

**Interfaces:**
- Produces: `export const PRISM_COOLDOWN_DAYS = 3`
- Produces: `export function parseVersion(text: string | null): string | null` — first dotted-number run in the text (`"prism-validator 1.19.1"` -> `"1.19.1"`), else `null`.
- Produces: `export function compareVersions(a: string, b: string): number` — numeric per dotted part, missing parts = 0; negative/0/positive.
- Produces: `export function pickRelease(pypiJson: unknown, { now: Date, cooldownDays: number }): { version: string, cutoff: string } | null` — highest stable (`/^\d+(\.\d+)*$/`) version in `pypiJson.releases` that has at least one file, not all files `yanked`, and whose earliest `upload_time_iso_8601` is at least `cooldownDays` old; `cutoff` = `now - cooldownDays` as ISO string. Malformed input returns `null` (never throws).

- [ ] **Step 1: Write failing tests:** `parseVersion` (three inputs incl. `null` and "no version here"); `compareVersions` (`1.9.0 < 1.20.0`, `1.20 == 1.20.0`); `pickRelease` with a fixture JSON: skips `1.22.0rc1`, skips a release younger than 3 days, skips a fully yanked release, returns `{ version: '1.21.0' }` for the fixture's newest eligible one; returns `null` for `{}`, `null`, `"x"`, and `{ releases: {} }`.
- [ ] **Step 2: Run** `node --test test/validator-update.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the three functions and the constant, no I/O.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: version logic for validator updates`.

### Task 2: Admin switch

**Files:**
- Modify: `src/gui/policy.js` (`loadPolicy` returns `updateCheckDisabled: boolean` next to `runDisabled`)
- Modify: `test/policy.test.js`

**Interfaces:**
- Produces: `loadPolicy(...)` result gains `updateCheckDisabled` (true when `env.DATALAD_DESKTOP_DISABLE_UPDATE_CHECK === '1'`, or any policy file has `updateCheckDisabled: true`, or a policy file exists but cannot be read/parsed — same fail-closed rule as `runDisabled`).

- [ ] **Step 1: Write failing tests** in `test/policy.test.js`, mirroring the existing `runDisabled` tests: env var `'1'` -> true; `'0'`/unset -> false; file `{ "updateCheckDisabled": true }` -> true; file with invalid JSON -> true; missing file (ENOENT) -> false.
- [ ] **Step 2: Run** `node --test test/policy.test.js`. Expected: FAIL (`updateCheckDisabled` undefined).
- [ ] **Step 3: Implement** by extending `loadPolicy` the same way `runDisabled` is handled; update the header comment.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: admin switch for update checks`.

### Task 3: An updated environment is never downgraded

**Files:**
- Modify: `src/datalad/managed-env.js` (`ensureEnv`)
- Modify: `test/managed-env.test.js`

**Interfaces:**
- Context: the update (Task 4) installs from a generated lock file, so the marker's `lock` hash differs from the shipped one. Produces: a new optional `ensureEnv` parameter `source?: string`, stored in the marker; Task 4 passes `source: 'auto-update'`. `ensureEnv` treats an existing, working env whose marker has `source === 'auto-update'` as up to date even when its `lock` differs from the shipped lock.

- [ ] **Step 1: Write failing tests:** (a) marker `{ python, lock: 'other', source: 'auto-update' }` and a working validator -> `ensureEnv` returns the status and runs no `uv` command; (b) same marker without `source` still triggers a clean reinstall (existing behaviour); (c) `ensureEnv({ ..., source: 'auto-update' })` writes `source` into the marker.
- [ ] **Step 2: Run** `node --test test/managed-env.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the optional `source` parameter and the marker check.
- [ ] **Step 4: Run** `node --test test/managed-env.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `fix: an auto-updated validator is not rolled back by Install`.

### Task 4: Update orchestrator

**Files:**
- Modify: `src/datalad/validator-update.js` (add below Task 1's code)
- Modify: `test/validator-update.test.js`

**Interfaces:**
- Consumes: Task 1 functions; `ensureEnv` (with the `source` parameter from Task 3), `envStatus`, `envBin`, `MANAGED_ENV` from `src/datalad/managed-env.js`; `interpretReport` from `src/datalad/prism-gate.js`; a `runner` with `run(command, args, options) -> { failed, exitCode, stdout, stderr }` (`ProcessRunner`).
- Produces: `export async function updateValidator(deps): Promise<{ status: 'updated' | 'current' | 'not-installed' | 'deferred' | 'failed' | 'retry', from?: string, to?: string, reason?: string }>` where `deps = { runner, uvPath, envDir, userDataDir, fetchJson: (url) => Promise<unknown>, now: () => Date, isBusy: () => boolean, platform?: string }`.
- Produces (internal, exported for tests): `compatCheck({ runner, envDir, platform, tmpDir }): Promise<boolean>` — runs the new env's validator as the Save check does (`[emptyDir, '--no-prism', '--bids', '--format', 'json']`) on an empty temp folder and returns true only if `interpretReport(stdout).verdict` is not `'unknown'`.
- Produces: persisted state file `join(userDataDir, 'validator-update.json')` = `{ failedVersion?: string }`.

Behaviour (the tests pin it): not installed (`envStatus.ready` false) -> `not-installed`, no fetch. `fetchJson('https://pypi.org/pypi/prism-validator/json')` throws or `pickRelease` null -> `offline`/`current` (no changes). Installed >= chosen -> `current`. `failedVersion === chosen` -> `current` (no retry). Otherwise: write `in.txt` (`prism-validator==<v>`), run `uv pip compile --no-config --python-version 3.12 --universal --generate-hashes --no-header --exclude-newer <cutoff> -o <lock> <in.txt>`; build `env.next` with `ensureEnv({ ..., envDir: <envDir>.next, lockPath: <lock>, source: 'auto-update' })`; `compatCheck`; if `isBusy()` -> remove `env.next`, return `deferred`; swap by renaming `env` -> `env.old`, `env.next` -> `env`, then removing `env.old`; if the second rename fails, rename `env.old` back and return `failed` with reason. Any failure removes `env.next`, records `failedVersion`, returns `failed` with a plain-language `reason`.

- [ ] **Step 1: Write failing tests** with a fake runner (records calls, scripted results) and temp dirs: (a) not installed; (b) up to date; (c) happy path returns `updated` with `from`/`to` and the swap happened (new env dir present, `.next` and `.old` gone); (d) `compile` args contain `--generate-hashes`, `--exclude-newer`, and the exact cutoff; (e) `isBusy` true -> `deferred`, original env directory unchanged; (f) compat check false -> `failed`, original untouched, `failedVersion` stored, second call with the same version makes no runner calls; (g) rename failure on the second rename restores the old env; (h) fetch throwing -> `offline` and zero runner calls; (i) `compatCheck` returns false for stdout `not json` and for a report containing code `PRISM902`, true for `{"valid":false,"issues":[]}`.
- [ ] **Step 2: Run** `node --test test/validator-update.test.js`. Expected: FAIL (`updateValidator` not defined).
- [ ] **Step 3: Implement** `updateValidator` and `compatCheck` per the behaviour above, composing the existing functions; plain-language `reason` strings (e.g. "The new version did not pass the safety test, so the current one stays.").
- [ ] **Step 4: Run** the same command, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: update prism-validator safely (build, verify, swap)`.

### Task 5: Notices for DataLad and git-annex

**Files:**
- Create: `src/datalad/tool-notices.js`
- Test: `test/tool-notices.test.js`

**Interfaces:**
- Consumes: `compareVersions`, `parseVersion` (Task 1); a `runner`; `resolveTool` (`src/datalad/resolve-tool.js`).
- Produces: `export async function collectNotices({ runner, fetchJson, userDataDir, platform?, resolve? }): Promise<Array<{ tool: 'datalad' | 'git-annex', installed: string, latest: string, message: string }>>` — installed versions from `datalad --version` and `git-annex version`; latest from `https://pypi.org/pypi/datalad/json` (`info.version`) and `https://formulae.brew.sh/api/formula/git-annex.json` (`versions.stable`), information only; omits a tool when installed >= latest, when either version is unknown, when lookups fail, or when the user skipped exactly that `latest` version. `message` is plain language and, when the tool's resolved path contains `/Cellar/`, `/homebrew/` or `/usr/local/`, ends with the line `Update it with: brew upgrade <tool>`; otherwise it says to update it the same way it was installed.
- Produces: `export async function skipNotice({ userDataDir, tool, version }): Promise<void>` — remembers the skip in `join(userDataDir, 'update-notices.json')` as `{ skipped: { [tool]: version } }`; a later, newer `latest` shows again.

- [ ] **Step 1: Write failing tests** (fake runner, fake `fetchJson`, temp dir): newer DataLad -> one notice with both versions in `message`; equal -> none; skipped version -> none, a newer one afterwards -> shown again; Homebrew path adds the `brew upgrade datalad` line, other path does not; fetch failure -> `[]`; `datalad --version` failing -> no notice for it; unparsable PyPI JSON -> none.
- [ ] **Step 2: Run** `node --test test/tool-notices.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `collectNotices` and `skipNotice`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: notices for newer DataLad and git-annex`.

### Task 6: Wire into the app

**Files:**
- Modify: `src/gui/main.js`, `src/gui/preload.js`
- Test: `test/update-wiring.test.js` (source-text pins, like `test/run-wiring.test.js`)

**Interfaces:**
- Consumes: `updateValidator` (T4), `collectNotices`/`skipNotice` (T5), `policy.updateCheckDisabled` (T2), `ensureGuard` (existing install lock), `toolRunner`, `resolveUv`, `uvBaseDir()`, `managedEnvDir()`.
- Produces IPC: `updates:status` -> `{ disabled: boolean, validator: { status, from?, to?, reason? } | null, notices: Array<{ tool, installed, latest, message }> }`; `updates:skip` (payload `{ tool, version }`, both strings, `tool` limited to `'datalad' | 'git-annex'`) -> `{ ok: true }`; event `updates:changed` (no payload) sent to the window when status changes. Preload: `getUpdateStatus()`, `skipUpdateNotice({ tool, version })`, `onUpdatesChanged(callback) -> unsubscribe` (same pattern as `onWatchChanged`).
- Behaviour: after the main window finished loading, if not `policy.updateCheckDisabled`, run once in the background (`setImmediate`, errors swallowed): `updateValidator` inside `ensureGuard.run` (so it cannot overlap an Install click) with `isBusy` true while any `gateSave`/`inspectProject` call is in flight (a counter incremented around the two existing call sites), then `collectNotices`; cache both results for `updates:status`; emit `updates:changed`. `fetchJson` uses global `fetch` with `AbortSignal.timeout(10_000)` and rejects non-2xx; the base URLs may be overridden by `DLAD_UPDATE_FEED` only when `!app.isPackaged` (for e2e). When disabled, no handler performs any request.

- [ ] **Step 1: Write failing tests** (read `main.js` and `preload.js` as text): `updates:status` and `updates:skip` handlers exist; the skip handler rejects other tools; the background run is guarded by `policy.updateCheckDisabled`; `updateValidator` runs inside `ensureGuard.run`; both gate call sites are wrapped by the busy counter; preload exposes the three functions; the feed override is gated on `!app.isPackaged`.
- [ ] **Step 2: Run** `node --test test/update-wiring.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the wiring in `main.js`/`preload.js`.
- [ ] **Step 4: Run** `node --test test/update-wiring.test.js`, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: run update checks in the background after start`.

### Task 7: The notice in the interface

**Files:**
- Modify: `src/gui/renderer/index.html`, `src/gui/renderer/app.js`, `src/gui/renderer/styles.css`
- Create: `src/gui/renderer/update-notice.js` (pure rendering helper)
- Test: `test/update-notice.test.js`, `e2e-walkthrough/updates.walkthrough.mjs`

**Interfaces:**
- Consumes: preload `getUpdateStatus`, `skipUpdateNotice`, `onUpdatesChanged` (T6).
- Produces: `export function describeUpdates(status): { lines: Array<{ text: string, skip?: { tool: string, version: string } }> }` — pure: a validator line only for `status.validator.status === 'updated'` ("prism-validator was updated from X to Y.") or `'failed'` ("prism-validator has a newer version that could not be installed. The current one keeps working."); one line per notice (`message`) with a `skip` target; empty `lines` when `disabled` or nothing to say.
- Produces DOM: `<div id="update-notice" role="status" aria-live="polite" hidden>` under the header (visible on the start screen and in a project), one row per line with a **Skip this version** button for notices (real `<button>`, keyboard reachable), and the PRISM Validator section in Setup shows the same validator line.

- [ ] **Step 1: Write failing tests:** `test/update-notice.test.js` for `describeUpdates` (disabled -> empty; updated -> text with both versions; failed -> reassuring text; notices carry `skip`; `current`/`offline`/`deferred` -> no line). Then `e2e-walkthrough/updates.walkthrough.mjs`: start a tiny local HTTP server serving a fake PyPI JSON for `datalad` (newer than installed) and a fake brew JSON, launch the app with `DLAD_UPDATE_FEED=<server url>` and `DATALAD_DESKTOP_DISABLE_UPDATE_CHECK` unset, assert `#update-notice` becomes visible with the DataLad line, click **Skip this version**, assert it disappears and stays gone after reopening the app on the same profile; a second test launches with `DATALAD_DESKTOP_DISABLE_UPDATE_CHECK=1` and asserts the server received zero requests and the notice stays hidden.
- [ ] **Step 2: Run** `node --test test/update-notice.test.js`, then `node --test --test-concurrency=1 e2e-walkthrough/updates.walkthrough.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `describeUpdates`, the markup/CSS (reuse existing notice/card styles and the amber colour pair that passes contrast), and the `app.js` wiring (fetch status at start, re-render on `onUpdatesChanged`).
- [ ] **Step 4: Run** both commands again plus `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: update notice with Skip this version`.

### Task 8: Documentation

**Files:**
- Modify: `SECURITY.md`, `README.md` (one short line), `docs/install.md` (Setup section if it lists the validator), `test/security-doc.test.js`

- [ ] **Step 1: Write failing test:** `SECURITY.md` mentions the auto-update of prism-validator (3-day cooldown, build-and-verify before swap, wheels/hashes), that DataLad and git-annex are only announced, and the admin switch `DATALAD_DESKTOP_DISABLE_UPDATE_CHECK` / `updateCheckDisabled`.
- [ ] **Step 2: Run** `node --test test/security-doc.test.js`. Expected: FAIL.
- [ ] **Step 3: Write** the documentation (plain language; the trade-off in one honest paragraph: updates come from PyPI, so a compromised release could reach users after the cooldown).
- [ ] **Step 4: Run** the test, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `docs: validator auto-update and update notices`.

---

## Self-review notes

- Spec coverage: auto-update of an installed validator (T1, T4), cooldown incl. dependencies (T1 + T4 `--exclude-newer`), build-then-swap and fallback (T4), compatibility with the Save check (T4 `compatCheck`), never during a Save (T4 `isBusy`, T6 counter), no retry loop (T4 `failedVersion`), notices for DataLad/git-annex with skip (T5, T7), Setup line (T7), admin switch (T2, T6), plain-language errors (T4, T7), no downgrade by Install (T3), docs (T8). Not covered by design: Python, the app itself, installing prism-validator for people who never installed it.
- Names to keep consistent: `updateValidator`, `compatCheck`, `pickRelease`, `collectNotices`, `skipNotice`, `describeUpdates`, `updateCheckDisabled`, `DLAD_UPDATE_FEED`, `env.next`.
- Not verified in the plan: how `uv pip compile --universal` behaves with `--exclude-newer` on every platform; T4's implementer must run it once for real on this Mac and report the command that worked.
