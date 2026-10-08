# Unified data actions in the Files tab

## Problem

Getting, freeing and unlocking file content is split from the file browser:

- The **Get Data & Sync** tab holds Get Data, Free Up Space and Unlock for Editing next to the remote actions (Update,
  Publish, Disconnect from Source, Add remote).
- Those three file actions read their paths from the "Advanced: manual file paths" box, which lives in the **Save
  Checkpoint** tab. To fetch one file a user must type its path in one tab and press a button in another.
- The **Files** tab shows which files are "Not downloaded" but can only Open and filter.

Goal: one system. The Files tab is the only place for actions on file content. Researchers click the file or folder
they want.

## Design

### Files tab, per row

Each row shows only the actions that apply, next to the existing **Open** button:

| Row | annexPresent | Actions |
| --- | --- | --- |
| file | `false` (not downloaded) | Get |
| file | `true` | Free up space, Unlock |
| file | `null` (not annexed) | none |
| folder | `false` or `'partial'` | Get |
| folder | `true` or `'partial'` | Free up space |

`'partial'` folders get both Get and Free up space. Unlock is offered for files only.

### Files tab toolbar

Next to Refresh Files: **Get all not-downloaded** (keeps the existing progress count from the project health snapshot)
and **Free up space (all)**.

### Behavior

Every action runs the existing `get`, `drop` or `unlock` workflow command through `runWorkflowCommand`, with
`paths: [<row path relative to the browsed project path>]` (toolbar buttons pass `paths: []`, as the old buttons did
with an empty box). Unchanged and reused:

- the confirmation dialogs (Unlock keeps its warning text; Free up space keeps its "only removed when another copy is
  confirmed" text, naming the row instead of "N selected item(s)");
- the gating rules (`computeDatasetGating`, `computeUnlockGating`, `computeAnnexToolGating`): when a rule disables an
  action, its buttons are disabled with the same title text;
- `refreshFileBrowser(projectPath)` after the command.

Freeing a partly downloaded folder drops whatever is present. DataLad's own check still refuses to drop content that has
no other confirmed copy.

No change to the main process, the adapter or the IPC surface.

### Removals and renames

- Remove the Get Data, Free Up Space and Unlock for Editing buttons and the Unlock info tooltip from the sync section.
  The Unlock explanation moves to the row button's title.
- The tab becomes **Sync** (tile label and section heading) and keeps Update, Publish, Disconnect from Source and Add
  remote, with their existing visibility and quiet-message logic. Its lede text drops the "download real file content"
  wording.
- The manual file paths box stays in Save Checkpoint and is used for saving only. Get, drop and unlock no longer read it.

## Testing (TDD, tests first)

1. Unit: a pure function in the renderer (`rowDataActions(node)`) returns the action list for a row per the table above.
   Tests cover every table row.
2. Wiring tests (`test/*.test.js`, regex over `index.html` / `app.js`, same style as the existing wiring tests):
   - the sync section has none of `get-data`, `drop-data`, `unlock-files`;
   - the Files toolbar has the two bulk buttons;
   - row rendering uses `rowDataActions`;
   - get, drop and unlock handlers no longer read `elements.paths`.
3. e2e: update `e2e/button-gating.e2e.mjs` and `e2e/science-workflow.e2e.mjs`, which use the old button ids.
4. Docs: update the tutorial pages that tell users to press Get Data in the Get Data & Sync tab.

## Out of scope

- Multi-select and checkboxes in the file list.
- A per-row overflow menu; revisit if rows get crowded.
- Any change to what `get`, `drop` or `unlock` do.
