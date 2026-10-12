# Round 3: Save the whole project, nested datasets included

Date: 2026-10-12. Branch `feat/recursive-save`, from `main` (independent of PR #28).

## Problem

A project with nested datasets (a BIDS project auto-nested into `sub-*` datasets, or a hand-made
superdataset) needs a **two-step save** today: Save inside the nested dataset, then Save again at the
root to record the nested dataset's new state. Until the second step the root shows ` M sub` and the
project looks half-saved. The "Project Data Folder" picker on Home makes this worse: it lets Save act
on one nested dataset only, which leaves the parent behind.

Measured with real DataLad (2026-10-12, a root with one subdataset):

| Command at the root | Result |
|---|---|
| `datalad save -m x` (no paths) | the subdataset's changes are **not saved**; root shows ` M sub`, sub still has its untracked file |
| `datalad save -m x -- sub/file` | saved **inside** the subdataset, root still shows ` M sub` |
| `datalad save -r -m x` | everything saved, root and sub clean |
| `datalad save -r -m x -- top.txt sub/file` | both files saved, root records the new sub state, all clean |

## Goal

One Save saves everything the user selected (or, with no selection, everything that changed),
including inside nested datasets, and leaves the whole project clean. No second step, no picker.
Decided with the maintainer on 2026-10-12: Save always saves the whole project; the nested-dataset
picker goes away.

Success: in a project with a nested dataset, changing one file in the root and one inside the nested
dataset, then pressing Save once, leaves `git status` clean in both.

## Changes

1. **Save is recursive.** The adapter's `save` command passes `-r` (`--recursive`) before the message:
   `datalad -C <project> save -r --message=<msg> [-- <paths>]`. This applies to every Save, including the
   PRISM/BIDS "saved together" path and the BIDS auto-nest flow (harmless there).
2. **The picker is removed.** `#dataset-select-field`, `#dataset-select`, `#refresh-datasets`, the
   `datasetSelect` change handler and the "pick which dataset Save applies to" hint go. The active folder is
   always the project root; `refreshDatasetList` keeps feeding the ignore-rules scope and the nested-dataset
   info line, but no longer fills a dropdown or switches the active folder.
3. **Copy.** The Files To Save help text and tutorials stop mentioning a dataset picker (none do today);
   the Save panel needs no new text, because nested files already appear under their dataset entry.

## Consequences to review

- With the picker gone, Files, History, Branches, Health and Sync always show the **root** dataset.
  Nested datasets remain visible as folders and as "subdataset" entries with their changed files in Files To
  Save. A user can no longer browse one nested dataset's own history from the app (the terminal still can).
  This is the cost of the "one project, one Save" model the maintainer chose.
- `save -r` checks every nested dataset. For a project with hundreds of subject datasets that is slower than a
  root-only save. Not measured on a large BIDS project; if it proves slow, the follow-up is to pass only the
  paths of datasets that actually changed.

## Testing

TDD. Adapter: the exact `save` arguments with and without paths (existing tests updated to include `-r`; the
`--message=--amend` flag-injection test keeps passing). Source-text tests: the picker markup and handler are
gone, nothing reads `datasetSelect`. Real DataLad e2e (`e2e/recursive-save.e2e.mjs`, needs `datalad` +
`git-annex`): root with a nested dataset, one change in each, Save with the default selection, assert both
repositories are clean and both messages exist; then Save with only the nested file selected and assert the root
records the new nested state (root clean).

## Out of scope

Browsing a single nested dataset (see above), per-dataset commit messages, the `datalad run` popup (round 4),
and the Windows non-ASCII file-name limitation.
