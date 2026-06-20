# Roadmap: DataLad Desktop

## Current state

This repository is currently a focused Electron prototype for DataLad workflows. It is not yet a GitHub Desktop fork and it does not currently preserve GitHub Desktop shell areas such as the native changes view, history UI, or project list.

What exists today:

1. Project detection for Git, DataLad dataset, and DataLad superdataset.
2. A thin adapter layer for environment checks, command execution, and researcher-facing error mapping.
3. A renderer prototype for clone, get, save, update, publish, branch actions, file browsing, and diagnostics.
4. A Rust core and Node bridge behind an opt-in feature flag.

## Product direction

The product goal is still a researcher-first desktop app where scientists can open a project, understand local state, fetch missing data, save work, update, and publish without needing to understand DataLad internals.

The next roadmap is therefore split into two tracks:

1. Stabilize and secure the current prototype so it is truthful, reliable, and testable.
2. Only then decide whether to keep evolving this standalone shell or replace it with a true GitHub Desktop fork baseline.

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

### Phase 6: Shell decision point

- Decide explicitly between:
  - continuing this standalone Electron shell, or
  - rebasing onto a real GitHub Desktop fork.
- If the fork path is chosen, record the exact upstream baseline and sync strategy before claiming shell parity.
- If the standalone path is chosen, rewrite product and UX docs to stop implying GitHub Desktop compatibility.

## Exit criteria for the current prototype

- The repository description matches the implemented product.
- The JS and Rust adapter paths expose the same runtime contract.
- The UI does not silently overwrite user intent during refreshes.
- Windows and macOS users can complete clone, save, get, update, and publish with documented prerequisites.
- Packaging and CI claims are backed by tested workflows.

## Explicit non-goals for the current phase

- Claiming GitHub Desktop shell parity before that code is actually present.
- Expanding to generic DataLad command forms.
- Adding broad metadata management UI.
- Mirroring the full DataLad CLI surface.
- Treating filesystem browsing as the primary product model.
