---
title: Cancel long-running commands + live activity line
status: implemented
date: 2026-09-30
---

# Cancel long-running commands + live activity line

## Why this exists

Clone, Get, Update, Publish and Save can run for minutes. Today the renderer
makes one IPC `invoke`, `ProcessRunner` buffers all output, and nothing is
returned until the process exits. A researcher cannot tell "working" from
"stuck", cannot stop a mistaken clone of a huge dataset, and quitting the app
mid-command orphans the `git`/`datalad`/`git-annex` processes.

Roadmap Phase 3 lists "cancellation and progress reporting for long-running
DataLad actions". This spec delivers the first version of that.

## Decisions (agreed with the maintainer)

| Question | Decision |
|---|---|
| Scope | **Cancel + live activity line.** No parsed progress bars (fragile, per-tool formats). |
| Which actions | **All** long-running actions run through `runWorkflowCommand` (clone/install, get, update, publish, save, create sibling, ...). |
| Console | **Included.** The opt-in power-user console gets the same Cancel. |
| Mechanism | **Run handles** (approach A): renderer-generated `runId`, main-process registry of `AbortController`s. Rejected: cancel-by-command-name (ambiguous for back-to-back `createSubdataset` runs; no name for console), worker/utility-process (restructures the runner for no gain). |
| Dependencies | None. Node built-ins only (`AbortSignal`, `spawn`, `taskkill`). See the zero-dependency posture. |

## Out of scope

- Parsed progress (percent, bytes, file counts).
- Automatic cleanup of partial results (half-cloned folder, partial annex
  content). The app never deletes user data on its own; the message tells the
  user what was left. git-annex resumes partial transfers.
- A graceful Windows shutdown. Windows has no SIGTERM equivalent for console
  processes, so Cancel there is `taskkill /T /F` immediately.

## Design

### 1. `ProcessRunner` (src/datalad/process-runner.js)

`run(command, args, { signal, onOutput, timeoutMs, killGraceMs, ... })`:

- **Pre-aborted signal** resolves immediately, without spawning.
- **Tree kill.** On POSIX the child is spawned `detached: true` so it leads
  its own process group; cancel sends `SIGTERM` to the group (`process.kill(-pid)`)
  and `SIGKILL` after `killGraceMs` (default 3000). The grace period matters:
  git and git-annex remove their own `.git/index.lock` on `SIGTERM`, `SIGKILL`
  would leave it. On Windows: `taskkill /pid <pid> /T /F`.
- **Timeouts** use the same tree-kill (this removes the "direct child only"
  limitation noted in the current `timeoutMs` code). They still resolve as
  timed out (exit 124), not cancelled.
- **Result of a cancelled run:** `{ failed: true, cancelled: true, exitCode: 130 }`
  plus the stdout/stderr captured so far.
- **No lock-retry for a cancelled run:** the retry loop checks the signal before
  sleeping and before re-running.
- **`onOutput(line)`** fires per chunk with the latest non-empty line, splitting
  on both `\n` and `\r` (progress bars redraw with `\r`). Output is still fully
  buffered for the final result, as today.
- **Kill failure** (`taskkill` error, `EPERM`): the run still resolves as
  cancelled after the grace period and the failure is logged.

### 2. Adapter, IPC and main process

- `adapter.runCommand(commandName, request, { signal, onOutput })` passes both
  through to `runner.run`. A cancelled result is mapped **before** normal error
  mapping to `userError.code = 'CANCELLED'` with a calm message ("Stopped by you").
  It is not a failure banner.
- **Registry** (new Electron-free module so it is unit-testable):
  `register(runId) -> AbortSignal`, `cancel(runId) -> boolean`, `abortAll()`,
  `finish(runId)`, plus a trailing-edge throttle helper for activity events.
- `adapter:runCommand` and `console:runCommand` accept an optional string
  `runId`, register it, run, and always `finish` in `finally`.
- New `adapter:cancelCommand(runId)` returns `true`/`false`. An unknown or
  finished id returns `false`, never an error (a cancel click can race
  completion). Cancelling twice is a no-op.
- Activity is forwarded as `command:activity { runId, line }`, throttled to
  about 4 per second, latest line wins, with a trailing send so the last line is
  not lost. Same pattern as the existing `watch:changed` event.
- `before-quit` calls `abortAll()`. This fixes orphaned child processes on quit.
- **Security unchanged:** project-root authorization stays on the run paths;
  cancelling needs only a `runId` this window created.
- **preload.js** exposes `runCommand(name, request, runId)`,
  `cancelCommand(runId)` and `onCommandActivity(cb)` (returns an unsubscribe,
  like `onFilesChanged`). The console payload carries `runId`.

### 3. Renderer (src/gui/renderer)

- `runWorkflowCommand` and `runConsoleCommand` create `runId` with
  `crypto.randomUUID()` and track it in `state.activeRuns`.
- **One shared strip**, `#running-commands` (hidden when idle): one row per
  active run, e.g. `Saving… · Adding: sub-01/T1w.nii.gz · [Cancel]`. Console
  runs appear in the same strip. Existing per-button "Working…" labels stay.
  Clicking Cancel calls `api.cancelCommand(runId)` and turns the row into
  "Stopping…".
- Accessibility: the strip is `aria-live="polite"`; each Cancel button is
  keyboard reachable with the accessible name "Cancel <action>".
- A small pure module (like `save-gating.js`) strips ANSI escapes, trims and
  truncates the activity line.
- **After a cancel:** status pill "Stopped." in the warning tone (not red); the
  output panel says so plainly, including that nothing was rolled back;
  working-tree status and project health refresh (today that only happens after
  a successful run). A lingering lock is handled by the existing
  REPO_LOCKED "Remove lock and retry" recovery on the next command.
- **Multi-step sequences** (BIDS nesting, batch conversions) call the runner in
  a loop. They must stop at the first `CANCELLED` result and not continue with
  the next folder.

## Edge cases

- Cancel racing completion: a no-op, the result stays normal.
- Double cancel: idempotent.
- Cancel during a lock-retry sleep: no further retry.
- Timeout vs cancel: timeout keeps exit 124 and is not reported as cancelled.
- App quit mid-command: all active runs are aborted.
- Kill failure: still resolves as cancelled after the grace period; logged.

## Testing (TDD, each test red first)

- **Runner (real processes):** cancelling kills a child **and its grandchild**;
  SIGTERM first, SIGKILL for a child that ignores it (fast via `killGraceMs`);
  a pre-aborted signal never spawns; a cancelled run is not lock-retried;
  `onOutput` splits on `\r` and `\n`; `timeoutMs` uses the tree-kill.
- **Pure units:** adapter passes `signal`/`onOutput` through and maps
  `CANCELLED`; the main-process registry (register, cancel, abortAll, throttle);
  the renderer activity-line helper.
- **E2E (real Electron window):** run a slow console command, click Cancel in the
  strip, assert the row disappears, the pill says "Stopped", and the process is
  gone. It runs in the existing Windows and macOS smoke jobs, which is what
  proves the Windows `taskkill` path.
- A multi-step sequence stops after a cancel (unit-testable once the loop's stop
  condition is a small pure function).

## Open risks

- The Windows tree-kill is only proven by the Windows CI e2e; it cannot be run
  on the maintainer's macOS machine.
- `detached: true` on POSIX changes signal propagation from the terminal (Ctrl-C
  in a dev terminal no longer reaches children of a detached spawn). The app is
  a GUI, so this only affects developers running from a terminal; `abortAll()` on
  quit covers the normal path.
