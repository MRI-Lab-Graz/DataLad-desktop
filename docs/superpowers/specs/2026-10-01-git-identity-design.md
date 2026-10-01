---
title: Git identity (name + email) setup with a commit guard
status: approved-in-chat, not yet reviewed as a file
date: 2026-10-01
---

# Git identity (name + email) setup with a commit guard

## Why this exists

The app never configures `user.name` / `user.email` (nothing in `src`, tests or
docs mentions them). The Windows installer installs Git but sets no identity, so
on a fresh machine Save is expected to fail at the commit ("Author identity
unknown" / "unable to auto-detect email address"), and DataLad prints "It is
highly recommended to configure Git before using DataLad". Researchers need to be
asked once, in plain language, and able to change it later.

## Decisions (agreed with the maintainer)

| Question | Decision |
|---|---|
| Where is it stored | **Git's global config** (`git config --global`), not app settings. One source of truth shared with the user's terminal Git. Rejected: injecting `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env vars from app settings (invisible, can silently differ from the CLI). |
| When asked | A dialog at launch whenever name or email is missing; editable later in **Setup**. |
| If dismissed | **"Later" is allowed, Save stays blocked.** Dialog reappears next launch; commit-creating commands are refused with a friendly message until set. |
| Dependencies | None (Node built-ins, existing `ProcessRunner`). |

## Design

### 1. Backend (`src/datalad/git-identity.js`, new)

- `getGitIdentity(runner)` runs `git config --global --get user.name` and
  `user.email` (exit 1 = unset = empty, not an error). Returns
  `{ available, name, email, complete }`; `available: false` when `git` cannot be
  spawned (no dialog, no block: Check Environment already reports it).
- `setGitIdentity(runner, { name, email })` trims, validates, then runs two
  `git config --global` calls with argument arrays (no shell). Returns
  `{ ok, error?, identity }` (errors are returned, not thrown, so the dialog shows
  a plain message). Validation lives only here: name non-empty, at most 200 chars,
  no control characters; email looks like `x@y.z`, at most 254 chars; neither may
  start with `-` (never let user text be parsed as a flag).
- Takes the runner as an argument and is independent of the adapter, so it works
  when the opt-in Rust adapter is active. Main uses its existing `ProcessRunner`.
- IPC `identity:get`, `identity:set`; preload `getGitIdentity()`,
  `setGitIdentity({ name, email })`.
- Only the global config is managed; a repo-local identity still wins in Git.

### 2. Renderer UI

- `#identity-overlay`: modal dialog built on the SSH-password dialog pattern
  (`role="dialog"`, `aria-modal`), fields Name and Email, inline `aria-live="polite"`
  error line, buttons **Later** and **Save**. Enter submits, Escape = Later, focus
  starts in the first empty field, fields are prefilled from existing Git config.
- Opens: once per launch when `available && !complete`; from a blocked commit
  command (idempotent, never stacks); from Setup's Change/Set button.
- Setup panel row "Git identity" above Check Environment: `Jane Doe <jane@lab.org>`
  with **Change…**, or a warning "Not set - Save is blocked until you set it" with
  **Set…**.

### 3. The block and the Save hint

- A small pure module defines `COMMIT_COMMANDS = save, createProject,
  createSubdataset, update` (re-verify each against the adapter when planning).
- Guard at the top of `runWorkflowCommand`, beside the sequence-stop guard: if the
  command is in the set and the identity is known to be incomplete, spawn nothing,
  open the dialog, return a runner-shaped result with
  `userError.code = 'IDENTITY_MISSING'` and the message "Set your name and email
  first. It's asked once, and you can change it any time in Setup." (warning tone).
  "Not yet loaded" counts as unknown: never block before the first
  `getGitIdentity()` result. On a block, refresh the identity once so someone who
  fixed it in a terminal is not trapped.
- `shouldStopSequence` also stops on `IDENTITY_MISSING` so BIDS nesting / Convert
  end at the first step instead of failing every folder and reopening the dialog.
  Create Project is blocked before anything is created.
- `computeSaveGating` gains optional `hasIdentity` (default true); when false the
  hint reads "Set your name and email in Setup before saving." (warning). The Save
  button stays clickable (existing rule in `save-gating.js`: a disabled button with
  no explanation reads as broken); the guard blocks at click time.

## Edge cases

- Git not installed: `available: false`, no dialog, no block.
- Identity set in a terminal while the app is open: re-read on Setup visit / dialog
  open / first block.
- Half-set: only the missing field is empty in the dialog.
- Unicode, apostrophes and spaces in names are fine; leading `-`, control
  characters and over-length values are rejected with a plain message.
- Windows: `git config --global` writes `%USERPROFILE%\.gitconfig`, which Git for
  Windows reads.

## Testing (TDD, each test red first)

- Unit with a fake runner: `getGitIdentity` (both set, one unset, neither, Git
  missing); `setGitIdentity` (exact two `git config --global` arg arrays, trimming,
  rejection of bad names/emails **without calling the runner**, a Git failure
  surfaced as `ok: false`); `shouldStopSequence` for `IDENTITY_MISSING`;
  `computeSaveGating` identity hint; the commit-command guard decision.
- E2E, hermetic: the e2e driver sets a temp `GIT_CONFIG_GLOBAL` for every launch so
  tests never touch a developer's real `~/.gitconfig`; by default that config
  contains an identity so existing e2e tests (including the real-annex Save) keep
  working on CI runners that have none. The new e2e launches without one and checks:
  the dialog appears at launch; Later then Save shows the message and runs no
  command; filling the dialog writes the temp config and unblocks Save.

## Out of scope / next

- SSH key helper in Setup (create key if missing, show/copy the public key, test
  connection to the configured studies server). `ssh-copy-id` does not exist on
  Windows, so the README's current key instructions do not work there.
- README section documenting identity + SSH key, with a short optional note on the
  Windows HTTPS credential helper (only relevant when publishing to GitHub/GitLab).
