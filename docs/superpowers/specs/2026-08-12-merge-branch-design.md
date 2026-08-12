---
title: Merge Branch (guided GUI action)
status: approved
date: 2026-08-12
---

# Merge Branch — Design

## Why this exists

DataLad Desktop's guided UI has Create Branch and Switch Branch
(`create-branch`, `switch-branch` in `src/gui/renderer/index.html`) but no
way to merge one branch into another — merging currently requires shelling
out to `git merge` in the opt-in Power User Mode console. This surfaced
while rewriting the tutorial docs (`docs/superpowers/plans/2026-08-12-zero-to-hero-tutorial.md`):
four of seven chapters (03-06) are built around branch integration, and
routing all of them through a raw terminal is a real product gap, not just
a docs framing choice.

The app is already partway there: `app.js`'s `ensureBranchActionSafety()`
gates every branch action on a dirty-working-tree check, `status.js`
already tracks a per-file `conflicted` flag and a `conflictCount`, the
changed-files view already renders a "conflict" badge per file
(`app.js:2464`), and `errors.js` already has a `MERGE_CONFLICT` error code
(currently applied to `update`/`switchBranch`/`createBranch`, since
`datalad update --merge` and checkout can both hit conflicts). Adding
`mergeBranch` slots into all of this existing machinery rather than
requiring new UI surface.

## Scope

**In scope:**
- A guided **Merge Branch** action: pick a branch from a dropdown next to
  the existing branch selector, click Merge.
- A guided **Abort Merge** action, shown only when a merge leaves conflicts
  behind (`conflictCount > 0`).
- Full Rust-bridge parity for both commands (added to `CURATED_COMMANDS` /
  `BRIDGE_COMMAND_SCHEMAS` in both `rust-core/src/adapter.rs` and
  `src/datalad/schema.js`, with matching Rust and JS command
  implementations) — not the JS-only "extended command" pattern used by
  `createBranchAt`/`discardChanges`/etc.

**Out of scope (explicit, decided 2026-08-12):**
- No in-app conflict-resolution UI (diff viewer, "keep mine/keep theirs",
  per-file editing, staging, committing). Resolving conflicts and
  committing the resolution still requires Power User Mode. Rationale:
  building real conflict resolution is a substantially larger feature than
  the merge action itself, and the app's existing pattern throughout
  (documented in `docs/product/researcher-workflow.md`'s "Power user mode"
  section) is guided happy path + Power User Mode escape hatch for
  anything the curated action set doesn't cover.
- No new conflict-listing UI component. The existing changed-files view
  already flags conflicted files (`entry.conflicted` → `status-chip-urgent`
  "conflict" badge, `app.js:2464`); refreshing status after a failed merge
  surfaces this automatically.

## Command layer

### `mergeBranch`

- Required: `projectPath`, `branchName` (the branch merged **into** the
  current branch — same shape as `switchBranch`, no separate "target
  branch" field since the target is always whatever's currently checked
  out).
- Builds: `git -C <projectPath> merge --no-edit <branchName>`.
  `--no-edit` is required, not cosmetic: without it, a non-fast-forward
  merge makes git open `$EDITOR` for the merge commit message, which hangs
  indefinitely when invoked non-interactively from the GUI.
- Added to `BRIDGE_COMMAND_SCHEMAS` in `src/datalad/schema.js`
  (`required: ['projectPath', 'branchName']`, matching `switchBranch`'s
  schema exactly) and to `CURATED_COMMANDS` / `command_schema` /
  `assert_command_request` in `rust-core/src/adapter.rs`. Reuses the
  existing `branchName` leading-dash validation guard (currently scoped to
  `createBranch | switchBranch` in both files — extend that match arm).

### `abortMerge`

- Required: `projectPath` only.
- Builds: `git -C <projectPath> merge --abort`.
- Same bridge treatment as `mergeBranch` — added to both the JS and Rust
  curated command sets, not JS-only.

### Parity test

`test/adapter-parity.test.js` asserts array equality (not just set
equality — order matters, per the existing comment in
`rust-core/src/adapter.rs:24-28`) between the JS and Rust command lists.
Both `mergeBranch` and `abortMerge` need to be added to both languages'
lists in the same relative order, or this test fails.

## Error handling

Extends existing `mapCommandError` (`src/datalad/errors.js`) and
`map_command_error` (`rust-core/src/adapter.rs`) — no new error-handling
machinery.

- **Conflict on merge**: the existing `MERGE_CONFLICT` code (currently
  triggered by `update | switchBranch | createBranch | createBranchAt`
  matching `/conflict|merge conflict|unmerged files|you need to resolve your current index first/`
  on stderr) gets `mergeBranch` added to its command-name list. Same
  title/message copy already in place — no new user-facing string needed.
- **Unknown branch to merge**: new `MERGE_TARGET_NOT_FOUND` code, triggered
  when `commandName === 'mergeBranch'` and stderr matches
  `/not something we can merge|unknown revision/`. Same shape as the
  existing `BRANCH_NOT_FOUND` case (title: "Branch was not found", adapted
  message for the merge context).
- **Abort with no merge in progress**: falls through to `DEFAULT_ERROR`
  (generic "DataLad Desktop could not finish this action..."). This is a
  defensive fallback, not a real path — the Abort button is only ever
  rendered when `conflictCount > 0`, which only happens after a conflicted
  merge.

## UI (`src/gui/renderer/app.js` / `index.html`)

- New elements in the branch panel, alongside the existing
  `branch-select` / `create-branch` / `switch-branch` /
  `refresh-branches`: a `merge-branch-select` dropdown (populated from the
  same branch list as `branch-select`, excluding the current branch) and a
  `merge-branch-button`.
- Merging is gated through the existing `ensureBranchActionSafety()`
  (`app.js:2611`) — same dirty-working-tree confirm-or-block flow every
  other branch action already uses. No new safety logic.
- On success: refresh working-tree status and branch view (existing
  pattern after other branch actions).
- On `MERGE_CONFLICT`: refresh working-tree status (conflicted files
  appear automatically via the existing badge rendering), and show an
  **Abort Merge** button (`abort-merge-button`) alongside the existing
  "Resolve conflicts before changing branches" messaging
  (`app.js:2617-2620`). The button stays visible for as long as
  `snapshot.conflictCount > 0`.
- On `MERGE_TARGET_NOT_FOUND` or other errors: same generic error-surfacing
  pattern already used for other branch action failures (no new UI path).

## Docs impact (follow-up, not part of this spec)

Once this ships, `docs/superpowers/plans/2026-08-12-zero-to-hero-tutorial.md`
Task 6 (Chapter 3) needs its Power-User-Mode-console merge steps replaced
with the new guided Merge button, and Tasks 7-9 (Chapters 4-6) need their
"switch back to Power User Mode console to merge" steps removed in favor of
the guided action. That plan update happens after this feature ships, not
as part of implementing it.
