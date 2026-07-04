# Roadmap: DataLad Desktop

## Current state

This repository is a focused, standalone Electron app for DataLad workflows. It is not, and will not become, a GitHub Desktop fork — the product decision (see Phase 6) is to stay independent of GitHub Desktop, not to track or preserve its shell areas (native changes view, history UI, project list, etc.).

What exists today:

1. Project detection for Git, DataLad dataset, and DataLad superdataset.
2. A thin adapter layer for environment checks, command execution, and researcher-facing error mapping.
3. A renderer prototype for clone, get, save, update, publish, branch actions, file browsing, and diagnostics.
4. A Rust core and Node bridge behind an opt-in feature flag.

## Product direction

The product goal is a researcher-first desktop app where scientists can open a project, understand local state, fetch missing data, save work, update, and publish without needing to understand DataLad internals — delivered as a stable, easy-to-use, secure, multi-platform version-control app that is explicitly independent of GitHub Desktop, not a fork or lookalike of it.

The near-term roadmap is a single track: stabilize and secure this standalone app so it is truthful, reliable, and testable, then keep evolving it as its own product (Phase 6 below records this decision — the "fork GitHub Desktop" alternative is closed).

## Near-term roadmap

### Phase 1: Prototype stabilization

- Keep the command set intentionally small: Clone/Install, Get, Save, Update, Push.
- Maintain one adapter boundary for environment checks, detection, command execution, and structured results.
- Keep Git-only projects usable without exposing unnecessary DataLad surface area.
- Preserve a single active project model.

### Phase 2: Security and safety

- Keep renderer resources local-only.
- Enforce strict navigation and permission rules in Electron.
- Prevent user-controlled command arguments from being parsed as flags.
- Keep file reveal actions non-executing.
- Add explicit handling for long-running commands, auth prompts, and timeouts.

### Phase 3: Workflow correctness

- Keep working-tree status, file browser badges, and save selection in sync.
- Preserve explicit user selection across refreshes.
- Eliminate stale async responses overwriting the current project view.
- Add automatic working-tree refresh via filesystem watching, scoped to the active project root, debounced, ignoring `.git`/`.datalad`/`.git/annex` internals and OS noise files, and paused while a command is in flight. This is the proactive counterpart to eliminating stale async responses: instead of only guarding against races, detect real disk changes and refresh without requiring a manual click. No tray/background mode and no scheduled/automatic saves — the app stays a foreground, user-triggered Save tool, just with a live status view.
- Improve subdataset save semantics so parent and child dataset behavior is unambiguous.
- Add cancellation and progress reporting for long-running DataLad actions.

### Phase 4: Windows-first hardening

- Validate PATH discovery and diagnostics for standard Windows installs.
- Test working-tree status, file paths, and packaging behavior on Windows.
- Document Windows credential-helper expectations for publish and update flows.
- Add installer validation and signing/notarization work for release builds.

### Phase 5: Packaging and release hygiene

- Keep macOS, Windows, and Linux packaging definitions explicit.
- Pin CI release actions and strengthen supply-chain provenance.
- Add release smoke tests for packaged apps, not just source checkouts.
- Separate packaging validation from product validation.

### Phase 6: Shell decision — decided

**Decision: standalone.** DataLad Desktop stays its own independent Electron app; it will not be rebased onto or claim parity with GitHub Desktop. The explicit product framing going forward is: a stable, easy-to-use, secure, multi-platform version-control app in its own right.

Follow-up from this decision (tracked here, not left implicit):
- Product/UX docs have been updated to stop implying GitHub Desktop compatibility (`docs/product/researcher-workflow.md`, `docs/architecture/datalad-adapter.md`).
- Marketing/README copy should describe the app on its own terms (done — README does not reference GitHub Desktop).
- No further work should frame missing GitHub Desktop shell areas (native changes view, history UI, project list) as gaps to close — they are out of scope by decision, not by omission.

## Exit criteria for the current prototype

- The repository description matches the implemented product.
- The JS and Rust adapter paths expose the same runtime contract.
- The UI does not silently overwrite user intent during refreshes.
- Windows and macOS users can complete clone, save, get, update, and publish with documented prerequisites.
- Packaging and CI claims are backed by tested workflows.

## Explicit non-goals for the current phase

- Claiming or pursuing GitHub Desktop shell parity — closed by the Phase 6 decision to stay standalone and independent, not just deferred.
- Expanding the curated GUI action set to generic DataLad command forms.
- Adding broad metadata management UI.
- Building GUI buttons that mirror the full DataLad CLI surface.
- Treating filesystem browsing as the primary product model.

These non-goals are about the curated novice-facing action set (Get/Save/Update/Publish), not about
power-user access in general. An opt-in command console (cwd locked to the project root) is in scope as
the power-user escape hatch for anything the GUI doesn't cover — it does not grow the curated button set
or change the default novice workflow. It intentionally has no command allowlist: it runs whatever the
power user types, exactly as a real terminal would. The execution model is platform-conditional rather
than identical everywhere: on macOS/Linux it runs as a single process with no shell (shell metacharacters
are literal text); on Windows it runs through `cmd.exe` like a normal Windows terminal, since Windows
cannot otherwise launch `.cmd`/`.bat`-shimmed tools (`npm`, `npx`, `yarn`, ...) — meaning shell operators
(`&`, `|`, `%VAR%`) are live on Windows but not on macOS/Linux for this one feature.
