# Close the git-annex hook-location class (review 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development). Steps use checkbox syntax.

**Goal:** Close review 3's findings (H1-H4, M1, M2, L1-L5) by replacing the scattered hook checks with one mechanism that finds every place git-annex can run a hook from, and treats anything it cannot read as a finding. Users work locally and with shared folders, so Push to a local-path remote must keep working: scan that remote's hook locations and show the normal trust prompt when it carries any.

**Root cause (all three reviews):** git-annex ignores `core.hooksPath` and runs `<gitdir>/hooks/<name>-annex` from locations the app cannot redirect. The app can only look in those locations, so the list of locations must come from git's own answers, not from guessing.

**Architecture:** `folder-trust.js` gets `hookSites(repo)` (git dir, common dir, local-path remotes' git dirs, all from `git rev-parse` / `git remote get-url`) and `annexHooksIn(dir)` (looks up each of the eight known git-annex hook names directly with `lstat`, plus any other `*annex*` file in the folder, never relying on `readdir` alone). Any read error becomes a session-only "not fully scanned" finding. `main.js` re-runs the trust check right before a Push, so a share that changed since the folder was opened is caught. `childEnv` adds `safe.bareRepository=explicit`. Request validation requires string fields.

**Spec:** the review-3 report (summarised in `.superpowers` ledger and `project_security_hardening_branch.md`) plus the user's decision on 2026-10-04: "scan and ask" for local remotes.

## Global Constraints
- TDD, one commit per task, `npm test`. Zero new npm dependencies. Fixtures only create marker files inside their own temp dir.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Branch `fix/neutralise-exec` (PR #7, draft).
- Known git-annex hook names (git-annex 10.2026): `pre-commit-annex`, `post-update-annex`, `freezecontent-annex`, `thawcontent-annex`, `secure-erase-annex`, `commitmessage-annex`, `http-headers-annex`, `pre-init-annex`.
- Local remote URL = `file://...`, an absolute path (POSIX, `C:\`/`C:/`, UNC `\\host\share`), or a relative path without a scheme and without a `host:` prefix.

## Review Focus
1. Pushing to a local bare remote and to a work-tree remote still works (no regression from `safe.bareRepository=explicit` or the hooks scan). Pinned in Task 3.
2. A remote on a share owned by someone else (git "dubious ownership") is still checked, by looking at its `.git/hooks` and `hooks` folders directly. Pinned in Task 2.
3. An unplugged remote path (does not exist) is not a finding. Pinned in Task 2.
4. A repo with many remotes does not slow opening noticeably (only repos with remotes cost extra spawns). Measured in Task 6.

### Task 1: One mechanism for hook locations, fail-closed (H3, H4, L3)
**Files:** `src/gui/folder-trust.js`, `test/folder-trust.test.js`.
Tests (RED first): (a) hooks planted in a linked worktree's own gitdir (`.git/worktrees/<n>/hooks/freezecontent-annex`) are reported when scanning the worktree; (b) a `hooks` folder with mode `0311` (listing denied, execute allowed) containing `freezecontent-annex` is reported (skip on win32); (c) a hook that cannot be read yields a `not fully scanned (cannot read hook <name>)` finding, never a fingerprint; (d) fingerprints are the full 64-hex sha256; (e) each of the eight names is reported when present; (f) stock hooks and non-annex hooks are not reported.
Implement `hookSites(runner, repo)` returning the unique absolute dirs of `rev-parse --absolute-git-dir` and `--git-common-dir`; `annexHooksIn(dir, prefix)` using `lstat` on each known name, then `readdir` for any other `/annex/i` name; any error other than ENOENT becomes the session-only finding.

### Task 2: Local remotes (H1)
**Files:** `src/gui/folder-trust.js`, `test/folder-trust.test.js`.
Tests: (a) a clone whose `origin` is a local path to a dataset with `freezecontent-annex` is reported as `remote origin: <path>: hook freezecontent-annex <hash>`; (b) `file://` URL; (c) a relative URL (`../R`); (d) an `ssh://` or `host:path` URL is not treated as local; (e) a missing remote path is not a finding; (f) a bare remote (`hooks/` at its top) is checked; (g) a `url.<base>.insteadOf` rewrite to a local path is followed (via `git remote get-url`); (h) when `git rev-parse` fails in the remote (ownership), `<path>/.git/hooks` and `<path>/hooks` are still looked at.
Implement `localRemotePaths(runner, repo)` using `git remote` + `git remote get-url --all` and `--push --all`, and `localPath(url, repo)`.

### Task 3: Check at the moment of Push; bare-format directories (H1 timing, H2, M2)
**Files:** `src/gui/main.js`, `src/datalad/process-runner.js`, `src/gui/folder-trust.js`, `test/trust-wiring.test.js`, `test/process-runner.test.js`, `test/folder-trust.test.js`.
Tests: (a) wiring: the `push` command calls `requireTrustedFolder(event, request.projectPath)` before `adapter.runCommand`; (b) `childEnv` carries `safe.bareRepository=explicit`; (c) real git: a bare-format directory with `core.bare=false` + `core.worktree` is refused by `git status` through ProcessRunner; (d) push and clone to and from a local bare remote and a work-tree remote still work through ProcessRunner with that override; (e) a failing scanner `git` call (`config --local --list`, `ls-files`, `rev-parse`) yields a session-only `not fully scanned (...)` finding (inject a runner that fails).

### Task 4: Input validation and the symlink gap (M1, L1)
**Files:** `src/datalad/schema.js`, `src/gui/main.js`, `test/schema.test.js`, `test/trust-wiring.test.js`.
Tests: every string field of every command rejects non-strings (array, object, number); `main.js` throws for a non-string/empty create/clone target; the location check uses `isWithinAuthorizedRoot(target)` (no `dirname`), and a real symlink as the last path component outside every root is caught (`isWithinRoots`).

### Task 5: Smaller items (L2, L4, L5)
**Files:** `src/gui/folder-trust.js`, `SECURITY.md`, tests.
Tests: `include.path` target contents are visible (`config --local --list --includes`); `describeVectors` strips `\p{Cc}\p{Cf}` and, for long findings, keeps the head and the tail so the value stays visible; SECURITY.md says git-annex runs at least eight `*-annex` hooks, lists the locations scanned (git dir, common dir, local remotes) and the Push-time check.

### Task 6: Gate
Unit + e2e suites, `npm audit`, timing of a scan on a dataset with 3 remotes and 1000 files (<500 ms), push, Smoke Cross Platform (read the Windows log), installer-smoke, then a FOURTH fresh independent review (any High → stop and ask).
