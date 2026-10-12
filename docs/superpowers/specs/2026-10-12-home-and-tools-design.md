# Home + Tools: restructure the project UI by importance

Date: 2026-10-12

## Problem

After a project is opened, seven equal-sized tiles (Save Checkpoint, Sync, Files,
Health Details, Project Setup, Time Machine, Power User Console) suggest every
section is equally important. It isn't. Scientists mainly need to see what
changed, save it, and look back. Health also shows up twice (Project Health card
plus Health Details tile).

## Goal

One **Home** view for the everyday loop (changes → Save → recent history), with
everything else behind a **Tools** button. No feature is removed and no action
changes behaviour; this is navigation and visual priority only.

Success: a first-time user who opens a project sees the changed files, the Save
button and recent history without clicking anything. Every existing feature is
still reachable within two clicks.

## Home (replaces the tile row)

Top to bottom:

1. **Project strip** (existing `#project-strip`) plus a new **Tools ▸** button.
   The Project Health card (`#project-health-card`) is removed and its status
   line (`#project-status-line`, from `computeStatusLine`) moves into the strip.
2. **Attention rows**, each rendered only when it has something to do:
   - merge in progress: the existing `#merge-banner`, always first
   - `N files not downloaded · [Get all]`: triggers the existing `#files-get-all` action
   - `N to publish · [Publish]` / `N to update · [Update]`: triggers the existing
     `#publish-project` / `#update-project` actions
3. **Save**: the current `#save-checkpoint-panel` content, unchanged (changed
   files with All/None, message, Save button, nested-dataset picker, manual paths
   under "Advanced").
4. **Recent history**: the existing `#recent-commits-output`, with a
   **Full history ▸** link that opens Tools → History.
5. **Last action result**: `#command-output` moves into a collapsed
   `<details>` "Details of last action".

Home cards carry no emoji badges. The Save button and the attention rows are the
only emphasised elements.

## Tools view

**Tools ▸** hides Home and shows a two-column view: a vertical list on the left,
the selected panel on the right, and **← Back to project** at the top. Existing
panels move in unchanged (ids, content and behaviour stay the same):

| List item | Panel id |
|---|---|
| 🗂️ Files | `files-panel` |
| 🔄 Sync | `sync-data-section` (list item shown under the same condition as today's Sync tile) |
| ⏳ History | `time-machine-zone` |
| 🩺 Health | `project-health-panel` |
| 🌿 Branches & Ignore | `project-setup-zone` (renamed from "Project Setup") |
| 🖥️ Console | `power-user-console` (power-user mode only, as today) |

- The list reuses `wireTileGroup` with the existing `data-nav-target` attributes,
  restyled vertically. Unlike today, Tools always has exactly one selection:
  clicking the selected item does nothing, and opening Tools defaults to Files.
- Icons appear only in this list, one per tool.
- Switching projects returns to Home.

## Logic and tests

- New pure function `computeAttentionRows(health)` in
  `src/gui/renderer/project-health-chips.js`. It returns
  `[{ kind: 'missing'|'publish'|'update', count, label, action }]`, using the same inputs
  as `computeMissingContentChip` / `computeSyncStatusChip`, and an empty array
  when nothing is actionable. Written test-first in `test/project-health-chips.test.js`.
- The Tools "always one selection" rule goes into `wireTileGroup` as an option and
  gets a unit test if it ends up as more than a one-line flag.
- e2e: `science-workflow` and `files-browser` click `[data-nav-target=…]` directly.
  They must click **Tools ▸** first. Add one e2e check: opening a project shows
  the Save button and recent history with no navigation.

## Docs

Update the user docs that name the old tiles: README.md, `docs/tutorials/*`,
`docs/product/researcher-workflow.md`. Rename "Project Setup" to
"Branches & Ignore" and describe the "Tools → …" paths. Historical plans under
`docs/superpowers/` are left as they are.

## Out of scope

Renaming "Save Checkpoint", changing any action's behaviour, the onboarding
(Open/Create project) screen, and `docs/presentation-slides-de.md`.
