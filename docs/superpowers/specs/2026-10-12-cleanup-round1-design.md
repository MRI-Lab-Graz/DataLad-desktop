# Round 1: cleanup (remove, rename, slim)

Date: 2026-10-12. Builds on `feat/home-and-tools` (PR #25); this branch is stacked on it.

## Goal

Make the app smaller and clearer for scientists tracking changes: remove two
features that duplicate what the terminal or the checkbox list already does, use
one vocabulary, give the work more room, and make the first click of the day
"continue where I left off". No new capabilities; every decision below was
agreed with the maintainer on 2026-10-12.

Success: Save has one way to choose files, there is no console, the words
"checkpoint" and "commit" no longer appear in the UI, an open project shows a
slim header, and the start screen offers one big button to continue.

## Changes

### 1. Remove "Advanced: manual file paths" from Save
The changed-files checkboxes already choose what is saved. Remove the
`<details>`, the `#paths` input, its listener and `parsePaths`/path plumbing in
the renderer. Save sends exactly the checked files.

### 2. Remove the Power User Console and Power user mode
Power users have the terminal; terminal `datalad run` commits already appear in
History. Removing the console also removes its security surface.

- Remove: console panel and Tools list item, `#power-user-mode-toggle` in Setup,
  `initPowerUserConsole`, `runConsoleCommand`, console history, the
  `console:*` IPC handlers in `main.js`, `runConsoleCommand`/`setConsoleEnabled`
  in `preload.js`, `src/datalad/console-command.js`, `src/gui/console-consent.js`,
  and `consoleDisabled` in `policy.js` (the policy file keeps `trustedRoots`).
- Remove tests that only cover the console: `test/console-command.test.js`,
  `test/console-consent.test.js`, `e2e/console-gate.e2e.mjs`,
  `e2e/console-policy.e2e.mjs`; trim the console cases from `test/policy.test.js`
  and `test/ipc-guard.test.js`.
- The power-user toggle also swapped the vocabulary (commit vs checkpoint); with
  one vocabulary (below) nothing is left for it to do.
- Docs: remove console mentions (README, `docs/product/researcher-workflow.md`,
  tutorials) and say that terminal runs show up in History.
- A stored `dataladDesktop.powerUserMode` value in localStorage is simply ignored.

### 3. One vocabulary: "save" / "saved version"
Everywhere in the UI and docs: the action is **Save**; a recorded state is a
**save**; a marked one (e.g. `paper-v1`) is a **version**. Never "checkpoint"
or "commit". Concretely:
- Panel title "Save", label "Message", button "Save", placeholder
  "Describe what you changed", guidance "Add a message, or Save will ask you for one."
- "Recent Commits" becomes "Recent saves"; the header meta reads
  "Last saved 5 minutes ago (d563195)", "No saves yet in this project.", and
  "Last save status unavailable."
- Setup copy "Saved checkpoints are labelled…" becomes "Saves are labelled…";
  the identity dialog likewise.
- `getMessageTermLabel` and `applyWorkTerminology` are deleted (no more variants).
- Git/DataLad terms stay where the user typed or sees raw output (command output
  panel, History run records).

### 4. Slim header when a project is open
The hero (title, tagline, logo, last-commit meta) shows only on the start
screen. With a project open, a one-line bar shows the small logo, "DataLad
Desktop", the version, Setup and Docs. The last-save meta moves into the project
strip, under the path, next to the status line.

### 5. Suggested save message
`suggestMessage(files)` (pure, new `src/gui/renderer/message-suggestion.js`)
returns text like `Update participants.tsv` / `Update participants.tsv and 2 more`
/ `Add notes.md` / `Delete old.csv` / `Update 5 files` for the checked files and
their git statuses. It is shown as the message field's placeholder while the
field is empty, and a small "Use suggestion" button next to the guidance text
fills the field with it (the maintainer asked for "one click accepts it").
Save still requires a message.

### 6. "Continue with <project>" on the start screen
Above Open/Create, a large button "Continue with *name*" for the most recent
project (`state.recentProjects[0]`), reusing the existing open flow. Hidden when
there are no recent projects. No new IPC: if the folder no longer exists the
existing open flow reports it (a USB drive unplugged shows the same message
as opening it by hand). The button is not shown while a project is open.
*Deviation from the earlier "disabled + note" idea, which needed a new IPC call
(more attack surface) for a message the open flow already gives.*

## Testing

TDD per item, repo style: pure logic in unit tests (`suggestMessage`), source-text
tests for markup and wiring (`test/home-tools-layout.test.js` pattern: no
`checkpoint`/`commit` wording in `index.html` user text, no `#paths`, no console
ids, slim header ids, Continue button), existing tests trimmed with the code they
cover. e2e: `science-workflow` and `files-browser` keep passing; `git-identity`
copy updated.

## Out of scope

Round 2 (diffs), round 3 (recursive Save and removing the nested-dataset picker),
round 4 (`datalad run` popup), renaming "History"/"Tools", and re-taking
screenshots.
