# Merge branches — design

Date: 2026-10-06. Status: approved in chat, spec under review. Target: v0.5.0 (blocks the release).

## Why

Tutorials 03–06 teach branch-based collaboration (feature → main, hotfix → release → main), but the app can
create and switch branches and cannot merge them. The maintainer considers merge essential for 0.5.0.

## Decisions (from the maintainer)

- Conflicts are resolved **per file, by picking a side** inside the app, with Cancel Merge and Finish Merge.
  No line-by-line editor; "I fixed it myself" covers edits made in the researcher's own editor.
- The merge source is a **local branch only** (the list Project Setup already shows). A collaborator's
  branch is switched to once (git creates the local branch from the remote), then merged.

## Scope

In: merging one local branch into the current branch of the active project (root repository only, like
the other branch actions); resolving conflicts; keeping installed subdatasets in step after the merge.

Out: merging remote branches directly, line-level conflict editing, rebase, cherry-pick, merging inside a
subdataset from the superdataset's view (open the subdataset as the project instead).

## Commands (adapter, `src/datalad/schema.js` + `adapter.js`)

All run `git -C <projectPath> …` through the existing process runner (literal pathspecs, app-owned
`core.hooksPath`, fsmonitor off). Branch names pass the existing branch-name check; paths follow `--`.

| Command | Request | Runs |
|---|---|---|
| `merge` | `projectPath`, `branchName` | `git merge --no-edit <branch>` (fast-forward when possible) |
| `resolveConflict` | `projectPath`, `path`, `side` (`ours` \| `theirs` \| `manual`) | see below |
| `finishMerge` | `projectPath` | `git commit --no-edit` |
| `abortMerge` | `projectPath` | `git merge --abort` |

`merge` exiting 1 with conflicts is **not** a failure: the result says `conflicts: true` and the UI shows the
banner. A merge that was already up to date says so.

`resolveConflict` reads the conflicted entry from `git ls-files -u -z -- <path>` (stages 2 = ours,
3 = theirs, with mode and object id) and then:

- chosen stage present, mode `160000` (subdataset): `git update-index --cacheinfo 160000,<sha>,<path>`;
- chosen stage present, any other mode: `git checkout --ours|--theirs -- <path>`, then `git add -- <path>`;
- chosen stage absent (that side deleted the file): `git rm -- <path>`;
- `manual`: refuse when the file is a regular file under 10 MiB containing a line that starts with
  `<<<<<<< `, `=======` or `>>>>>>> ` (conflict markers left); otherwise `git add -- <path>`.

A path that is not currently conflicted is refused.

Annexed files are symlinks or pointer files, so the same rules apply; when the chosen side's content is not
on this computer, Get Data fetches it as usual.

## Merge state in the working-tree status (`src/datalad/status.js`, `getWorkingTreeStatus`)

The snapshot gains:

- `mergeInProgress` — `MERGE_HEAD` exists (`git rev-parse -q --verify MERGE_HEAD`);
- `mergeBranch` — the name from `MERGE_MSG`'s first line when it is `Merge branch '<name>'…`, else null;
- per conflicted entry, `sides`: which of ours/theirs exist (from `ls-files -u`).

This also covers conflicts left by **Update** (`datalad update --merge`), which today leave the researcher
with Save blocked and no way forward in the app.

## Subdatasets after a merge

`git merge` updates the recorded subdataset commit but not the subdataset's checkout. A later Save would
record the old checkout again and silently undo the merge. So after `merge` (clean) and after
`finishMerge`, for each **installed** subdataset whose recorded commit differs from its `HEAD`
(`git submodule status`, `+` prefix):

- when its work tree is clean, run `git -C <sub> merge --ff-only <recorded commit>`, then repeat for its own
  subdatasets;
- otherwise, or when the fast-forward fails, leave it and return a warning: "Subdataset X has its own
  changes; it was not moved to the merged version."

Local only; no network. Uninstalled subdatasets are untouched (Get Data installs the recorded version).

## UI (`src/gui/renderer`)

- **Project Setup → Branches:** "Merge into current branch" select (local branches minus the current one)
  and a Merge button. Before merging, refresh status: refuse with "Save your changes first" when anything is
  modified or staged (untracked files are allowed; git refuses if one would be overwritten, mapped below).
- **Merge banner** above the changed-files list while `mergeInProgress`: "Merging *X* into *Y* — N files to
  decide". Each conflicted file: **Keep this branch's version**, **Keep X's version**, **I fixed it
  myself**. Banner buttons: **Cancel Merge** (confirm dialog) and **Finish Merge** (enabled at 0 conflicts).
- During a merge: Save is hidden (Finish Merge is the save), branch actions and Merge are blocked.
- Identity guard: `merge` and `finishMerge` join `COMMIT_COMMANDS` (`identity-guard.js`).

## Errors (researcher language, existing error mapping)

- untracked file would be overwritten → "A new file here has the same name as one on X. Move or rename
  it, then merge again." (lists the files)
- already up to date → "Nothing to merge: this branch already has everything from X."
- a merge already in progress → "Finish or cancel the current merge first."
- detached HEAD (e.g. after browsing Time Machine) → "Switch to a branch before merging." (checked before running)
- unrelated histories → "These branches share no history and cannot be merged here." (no
  `--allow-unrelated-histories`)

## Security

No new execution surface: a repository-defined merge driver needs `merge.<name>.driver` in the
repository config, which is not on the folder-trust allowlist and is already reported; hooks come from the
app-owned `core.hooksPath`. `merge` is local, so it is not in the push trust re-check list. SECURITY.md gets
one line saying so.

## Testing (TDD)

- Unit: schema entries, command builders, `ls-files -u` parsing, conflict-marker check, merge-state
  parsing, gating (Save hidden / branch actions blocked during a merge, Finish enabled at 0), identity guard.
- Real git (temp repos, like `test/own-tags-real-git.test.js`): clean merge, fast-forward, up to date, text
  conflict resolved ours and theirs, modify/delete, "I fixed it myself" refused with markers then accepted,
  abort, a subdataset conflict, subdataset fast-forwarded after merge and warned when it cannot be.
- Real DataLad (skipped when datalad is missing, like other e2e): an annexed-file conflict resolved by
  side.
- e2e: in `e2e/science-workflow.e2e.mjs`, branch → conflicting saves → Merge → keep one side → Finish
  Merge → history shows the merge. Runs on the Windows CI smoke.

## Docs

Rewrite tutorials 03–06 against the real buttons (Merge, the banner, Mark As Version for the paper freeze);
README feature list; CHANGELOG 0.5.0 entry; SECURITY.md line.
