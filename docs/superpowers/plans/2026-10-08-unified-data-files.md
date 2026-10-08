# Unified data actions in the Files tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get, Free up space and Unlock for file content are done from rows (and a toolbar) in the Files tab; the old "Get Data & Sync" tab becomes "Sync" and keeps only the remote actions.

**Architecture:** A pure function `rowDataActions(node)` decides which actions a Files-tab row gets. A single delegated click handler plus two toolbar buttons call one function, `runDataAction`, which runs the existing `get` / `drop` / `unlock` workflow commands. The old buttons and their handlers are deleted. No main-process, adapter or IPC change.

**Tech Stack:** Vanilla JS renderer (ES modules), Electron, Node built-in test runner (`npm test`), Playwright-style e2e driver in `e2e/`.

**Spec:** `docs/superpowers/specs/2026-10-08-unified-data-files-design.md`

## Global Constraints

- TDD for every new function: the failing test is written and seen failing before the implementation (repo rule in `CLAUDE.md`). Tests run with `npm test`.
- No change under `src/datalad/` or to `src/gui/main.js` / `src/gui/preload.js`.
- A row action passes its path **relative to `state.fileBrowserProject`** (the folder the Files tab is showing), as `paths: [relativePath]`. Toolbar buttons pass `paths: []`.
- Confirmation dialogs keep their existing wording (Unlock's warning, Free up space's "only removed when another copy is confirmed"); Free up space names the row instead of "N selected item(s)".
- The "Advanced: manual file paths" box stays in Save Checkpoint and is used for saving only.
- Before merging into `main`, run the `ponytail:ponytail-audit` skill over the changes (repo rule).
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

Failure modes the spec implies but no task's own happy-path would catch; each has a test in the named task.

1. A file name with spaces, commas, quotes or `&` must reach the command as one path and not break the HTML attribute — Task 2 (escaped `data-data-path`, array `paths`).
2. Browsing a nested subdataset: the path is relative to the browsed folder, not the root project — Task 2 (`state.fileBrowserProject`).
3. Clicking Get on a folder row must not also expand or collapse the folder (the buttons sit inside `<summary>`) — Task 2 (`preventDefault`).
4. A plain Git project or a not-annexed file gets no data buttons at all — Task 1 (`annexPresent` null) and Task 3 (toolbar gating unchanged for plain Git).
5. The Sync tab must not flash its "Nothing to sync" line before health data has loaded — Task 3 (`computeSyncActionsQuietMessage(null)`).

## File structure

| File | Change | Responsibility |
| --- | --- | --- |
| `src/gui/renderer/row-data-actions.js` | create | pure: which actions a file-tree row gets |
| `test/row-data-actions.test.js` | create | unit tests for the above |
| `test/files-data-actions.test.js` | create | wiring tests for the Files tab and the removals |
| `src/gui/renderer/app.js` | modify | render row buttons, `runDataAction`, delegated + toolbar handlers; delete old buttons' handlers |
| `src/gui/renderer/index.html` | modify | toolbar buttons; remove old buttons; rename tab/section to Sync |
| `src/gui/renderer/styles.css` | modify | gap between row buttons |
| `src/gui/renderer/button-gating.js` | modify | drop `computeUnlockGating`; quiet message about remote only; reword titles |
| `test/button-gating.test.js` | modify | follow the gating changes |
| `e2e/button-gating.e2e.mjs`, `e2e/science-workflow.e2e.mjs` | modify | use the new buttons |
| `docs/product/researcher-workflow.md` | modify | describe the new action locations |

---

### Task 1: `rowDataActions`

**Files:**
- Create: `src/gui/renderer/row-data-actions.js`
- Test: `test/row-data-actions.test.js`

**Interfaces:**
- Produces: `rowDataActions({ type, annexPresent }) -> Array<{ action: 'get'|'drop'|'unlock', label: string, title: string }>`. `type` is `'file'` or `'directory'`; `annexPresent` is `true`, `false`, `'partial'` or `null`/`undefined`. Task 2 renders these.

- [ ] **Step 1: Write the failing test**

Create `test/row-data-actions.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { rowDataActions } from '../src/gui/renderer/row-data-actions.js'

const actions = (type, annexPresent) => rowDataActions({ type, annexPresent }).map((a) => a.action)

test('a file that is not downloaded can only be fetched', () => {
  assert.deepEqual(actions('file', false), ['get'])
})

test('a downloaded file can be freed up or unlocked', () => {
  assert.deepEqual(actions('file', true), ['drop', 'unlock'])
})

test('a folder that is not downloaded can be fetched', () => {
  assert.deepEqual(actions('directory', false), ['get'])
})

test('a fully downloaded folder can be freed up', () => {
  assert.deepEqual(actions('directory', true), ['drop'])
})

test('a partly downloaded folder can be fetched or freed up', () => {
  assert.deepEqual(actions('directory', 'partial'), ['get', 'drop'])
})

test('rows that are not annexed (plain Git files, unknown state) get no data actions', () => {
  for (const type of ['file', 'directory']) {
    assert.deepEqual(actions(type, null), [], type)
    assert.deepEqual(actions(type, undefined), [], type)
  }
})

test('every action carries a label and a title', () => {
  for (const a of [...rowDataActions({ type: 'file', annexPresent: true }), ...rowDataActions({ type: 'file', annexPresent: false })]) {
    assert.ok(a.label && a.title, a.action)
  }
  assert.match(rowDataActions({ type: 'file', annexPresent: true }).find((a) => a.action === 'unlock').title, /real, editable copy/)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/row-data-actions.test.js`
Expected: FAIL (cannot find module `row-data-actions.js`).

- [ ] **Step 3: Write the implementation**

Create `src/gui/renderer/row-data-actions.js`:

```js
// Which data actions a Files-tab row offers. Only annexed content has any: a row whose annexPresent is null is a plain
// Git file or an unknown state and gets none.
const GET = { action: 'get', label: 'Get', title: 'Download the actual content from your remote or backup.' }
const DROP = {
  action: 'drop',
  label: 'Free up space',
  title: 'Remove the local copy to free disk space. Only works when another copy (remote or backup) is confirmed; Get brings it back.'
}
const UNLOCK = {
  action: 'unlock',
  label: 'Unlock',
  title:
    "Use with caution. Some other software can't open DataLad-managed files because they are links to the underlying data, " +
    'not normal files. Unlock replaces the link with a real, editable copy of this file. This roughly doubles disk usage ' +
    "for the file until you run Save again, which puts it back under DataLad's tracking."
}

/**
 * @param {{ type: 'file'|'directory', annexPresent?: boolean|'partial'|null }} node
 * @returns {Array<{ action: 'get'|'drop'|'unlock', label: string, title: string }>}
 */
export function rowDataActions({ type, annexPresent }) {
  if (annexPresent === null || annexPresent === undefined) return []
  if (type === 'directory') return [annexPresent !== true && GET, annexPresent !== false && DROP].filter(Boolean)
  return annexPresent === false ? [GET] : annexPresent === true ? [DROP, UNLOCK] : []
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/row-data-actions.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/gui/renderer/row-data-actions.js test/row-data-actions.test.js
git commit -m "feat: rowDataActions decides which data actions a file row gets

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Files tab gets the actions

**Files:**
- Modify: `src/gui/renderer/index.html` (Files toolbar, `#files-panel` section-actions)
- Modify: `src/gui/renderer/app.js` (imports, `elements`, `renderFileTreeNodes`, new `runDataAction` + handlers, `updateGetDataGating`)
- Modify: `src/gui/renderer/styles.css` (`.finder-action-cell`)
- Test: `test/files-data-actions.test.js` (create)

**Interfaces:**
- Consumes: `rowDataActions` from Task 1; existing `runWorkflowCommand(commandName, request, button, busyLabelOverride, options)`, `refreshFileBrowser(projectPath)`, `readProjectPath()`, `state.fileBrowserProject`, `state.rootProjectPath`, `state.projectHealthSnapshot`, `computeDatasetGating`, `computeAnnexToolGating`.
- Produces: element ids `files-get-all` and `files-free-all`; attributes `data-data-action` (`get`|`drop`|`unlock`) and `data-data-path` on row buttons; function `runDataAction(action, button, relativePath)` (`relativePath` null = everything).

- [ ] **Step 1: Write the failing test**

Create `test/files-data-actions.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../src/gui/renderer/${p}`, import.meta.url), 'utf8')
const html = read('index.html')
const app = read('app.js')
const between = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)))

test('the Files toolbar has Get all and Free up space (all)', () => {
  const panel = between(html, 'id="files-panel"', 'id="project-health-panel"')
  assert.match(panel, /id="files-get-all"/)
  assert.match(panel, /id="files-free-all"/)
})

test('file rows render their data actions from rowDataActions, with an escaped path', () => {
  assert.match(app, /import \{ rowDataActions \} from '\.\/row-data-actions\.js'/)
  const render = between(app, 'function renderFileTreeNodes', 'function renderGitStatusBadge')
  assert.match(render, /rowDataActions\(node\)/)
  assert.match(render, /data-data-path="\$\{escapeHtml\(node\.relativePath\)\}"/)
})

test('data actions run against the browsed project, as one path each, with their confirmations', () => {
  const run = between(app, 'async function runDataAction', '\n}\n')
  assert.match(run, /state\.fileBrowserProject/)
  assert.match(run, /relativePath \? \[relativePath\] : \[\]/)
  assert.match(run, /runWorkflowCommand\(action,/)
  assert.match(run, /window\.confirm/)
})

test('a click on a row action does not also toggle the folder it sits in', () => {
  const handler = app.slice(app.indexOf("closest('[data-data-action]')"))
  assert.match(handler.slice(0, 400), /event\.preventDefault\(\)/)
})

test('the toolbar buttons are gated with the existing rules', () => {
  const gating = between(app, 'function updateGetDataGating', 'function updateSyncSectionVisibility')
  assert.match(gating, /filesGetAllButton\.disabled = gating\.disabled/)
  assert.match(gating, /filesFreeAllButton\.disabled = dropGating\.disabled/)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/files-data-actions.test.js`
Expected: FAIL on all five tests (ids, import and function missing).

- [ ] **Step 3: Implement**

3a. `src/gui/renderer/index.html`: in `#files-panel`, replace

```html
              <button id="open-active-folder" class="button button-ghost" type="button">Open Folder</button>
              <button id="refresh-files" class="button button-ghost" type="button">Refresh Files</button>
```

with

```html
              <button id="files-get-all" class="button button-ghost" type="button">Get all not-downloaded</button>
              <button id="files-free-all" class="button button-ghost" type="button">Free up space (all)</button>
              <button id="open-active-folder" class="button button-ghost" type="button">Open Folder</button>
              <button id="refresh-files" class="button button-ghost" type="button">Refresh Files</button>
```

and replace the Files lede `Browse visible files in the selected project folder.` with

```html
Browse files in the selected project folder. Get downloads content, Free up space removes a local copy, and Unlock makes an editable copy if another program can't open a file.
```

3b. `src/gui/renderer/app.js`: add to the imports, after `import { joinProjectPath, existingFolderProblem } from './project-path.js'` (if that line is not present on this branch, add it after the `escape-html.js` import):

```js
import { rowDataActions } from './row-data-actions.js'
```

In the `elements` object, next to `filesOutput: document.getElementById('files-output'),` add:

```js
  filesGetAllButton: document.getElementById('files-get-all'),
  filesFreeAllButton: document.getElementById('files-free-all'),
```

In `renderFileTreeNodes`, directly after the `const openButton = ...` statement add:

```js
      const dataButtons = rowDataActions(node)
        .map(
          ({ action, label, title }) =>
            `<button type="button" class="button button-ghost button-mini" data-data-action="${action}" data-data-path="${escapeHtml(node.relativePath)}" title="${escapeHtml(title)}">${label}</button>`
        )
        .join('')
```

then change the two action cells: `<span class="finder-action-cell">${convertButton}${openButton}</span>` becomes `<span class="finder-action-cell">${convertButton}${dataButtons}${openButton}</span>`, and `<span class="finder-action-cell">${openButton}</span>` becomes `<span class="finder-action-cell">${dataButtons}${openButton}</span>`.

Directly after the existing `elements.filesOutput.addEventListener('click', ...)` handler that calls `revealPath(targetPath)`, add:

```js
// Get / Free up space / Unlock from a Files row (relativePath, relative to the folder being browsed) or, from the
// toolbar, on everything (relativePath null).
async function runDataAction(action, button, relativePath) {
  const projectPath = state.fileBrowserProject ?? readProjectPath()
  if (!projectPath) {
    return
  }
  const paths = relativePath ? [relativePath] : []

  if (action === 'drop') {
    const scope = relativePath ? `"${relativePath}"` : 'all downloaded data in this folder'
    const confirmed = window.confirm(
      `Free up space by removing the local copy of ${scope}?\n\n` +
        '- Only removed when another copy (your remote or backup) is confirmed. Otherwise nothing happens.\n' +
        '- Files stay listed; use Get to download them again.\n\n' +
        'Continue?'
    )
    if (!confirmed) {
      return
    }
  }

  if (action === 'unlock') {
    const confirmed = window.confirm(
      'Unlock replaces the link to this file with a real, editable copy.\n\n' +
        '- This roughly doubles disk usage for the file until you Save again.\n' +
        '- Run Save afterward to put it back under normal DataLad tracking.\n\n' +
        'Continue?'
    )
    if (!confirmed) {
      return
    }
  }

  // ponytail: total known only for "get everything" in the root dataset (health counts the root only).
  const progressTotal =
    action === 'get' && paths.length === 0 && projectPath === state.rootProjectPath
      ? state.projectHealthSnapshot?.missingContentCount ?? null
      : null
  await runWorkflowCommand(action, { projectPath, paths }, button, undefined, { progressTotal })
  await refreshFileBrowser(projectPath)
}

elements.filesOutput.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-data-action]')
  if (!target) {
    return
  }

  event.preventDefault() // the buttons sit inside a folder's <summary>; don't also expand or collapse it
  await runDataAction(target.getAttribute('data-data-action'), target, target.getAttribute('data-data-path'))
})

elements.filesGetAllButton.addEventListener('click', () => runDataAction('get', elements.filesGetAllButton, null))
elements.filesFreeAllButton.addEventListener('click', () => runDataAction('drop', elements.filesFreeAllButton, null))
```

In `updateGetDataGating`, after the line `elements.getDataButton.title = gating.title` add:

```js
  elements.filesGetAllButton.disabled = gating.disabled
  elements.filesGetAllButton.title = gating.title
```

and after the line `elements.dropDataButton.title = dropGating.title` add:

```js
  elements.filesFreeAllButton.disabled = dropGating.disabled
  elements.filesFreeAllButton.title = dropGating.title
```

3c. `src/gui/renderer/styles.css`: add `gap: 0.4rem;` inside the `.finder-action-cell { ... }` rule.

- [ ] **Step 4: Run the tests**

Run: `node --test test/files-data-actions.test.js` then `npm test`
Expected: PASS; full suite green (the old buttons still exist at this point).

- [ ] **Step 5: Commit**

```bash
git add src/gui/renderer/index.html src/gui/renderer/app.js src/gui/renderer/styles.css test/files-data-actions.test.js
git commit -m "feat: Get, Free up space and Unlock from the Files tab

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Remove the old buttons; the tab becomes Sync

**Files:**
- Modify: `src/gui/renderer/index.html`, `src/gui/renderer/app.js`, `src/gui/renderer/button-gating.js`
- Test: `test/files-data-actions.test.js` (append), `test/button-gating.test.js` (modify)

**Interfaces:**
- Consumes: Task 2's toolbar buttons and `updateGetDataGating`.
- Produces: `computeSyncActionsQuietMessage(health)` (one argument now, was `(classification, health)`); `computeUnlockGating` no longer exists.

- [ ] **Step 1: Write the failing tests**

Append to `test/files-data-actions.test.js`:

```js
test('the old Get Data / Free Up Space / Unlock buttons are gone from the page and the script', () => {
  for (const id of ['get-data', 'drop-data', 'unlock-files', 'unlock-info']) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`), id)
  }
  for (const name of ['getDataButton', 'dropDataButton', 'unlockFilesButton']) {
    assert.doesNotMatch(app, new RegExp(name), name)
  }
})

test('the tab is called Sync and no longer mentions file content', () => {
  const tile = between(html, 'id="project-nav-tile-sync"', '</button>')
  assert.match(tile, /<span class="onboarding-tile-label">Sync<\/span>/)
  const section = between(html, 'id="sync-data-section"', 'id="files-panel"')
  assert.match(section, /<h2 id="sync-data-title">Sync<\/h2>/)
  assert.doesNotMatch(section, /Get Data|Manual File Paths|Unlock/)
})
```

In `test/button-gating.test.js`, replace the import of `computeUnlockGating` (delete that name from the import list), delete the four `computeUnlockGating ...` tests (the ones whose titles start `computeUnlockGating`), and replace the four `computeSyncActionsQuietMessage` tests (from `test('computeSyncActionsQuietMessage returns a message when a dataset has no remote and nothing to get'` through `test('computeSyncActionsQuietMessage uses git-only wording ...'` inclusive) with:

```js
test('computeSyncActionsQuietMessage explains a project with no remote, for datasets and plain Git alike', () => {
  for (const health of [
    { hasUpstream: false, annexSupported: true, missingContentCount: 0 },
    { hasUpstream: false, annexSupported: true, missingContentCount: 2 },
    { hasUpstream: false }
  ]) {
    const message = computeSyncActionsQuietMessage(health)
    assert.match(message, /Nothing to sync right now/)
    assert.match(message, /Add a Remote/)
    assert.doesNotMatch(message, /Get Data/)
  }
})

test('computeSyncActionsQuietMessage returns null once there is a remote to sync with', () => {
  assert.equal(computeSyncActionsQuietMessage({ hasUpstream: true, upstream: 'origin/main' }), null)
})

test('computeSyncActionsQuietMessage returns null before health has resolved (avoids a premature flash)', () => {
  assert.equal(computeSyncActionsQuietMessage(null), null)
  assert.equal(computeSyncActionsQuietMessage(undefined), null)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`
Expected: FAIL in `files-data-actions.test.js` (ids still present, tab still named Get Data & Sync) and in the new quiet-message tests (old signature takes `(classification, health)`).

- [ ] **Step 3: Implement**

3a. `src/gui/renderer/button-gating.js`:
- Delete `NOT_A_DATASET_UNLOCK_TITLE`, `UNLOCK_READY_TITLE` and the whole `computeUnlockGating` function with its JSDoc.
- Change `NO_REMOTE_TITLE` to end with `'This project can still be used fully offline with Save.'`.
- In the doc comment above `computeSyncSectionVisible` replace `The "Get Data & Remote Sync" section only makes sense when there's something to sync with: a configured remote, or a DataLad dataset whose annexed files might have real content to fetch.` with `The Sync section only makes sense when there's something to sync with: a configured remote, or a DataLad dataset that could be given one (Add a Remote lives there).`
- Replace `computeSyncActionsQuietMessage` (and its JSDoc) with:

```js
/**
 * Without a remote, Update and Publish are both disabled — two greyed buttons plus an info icon read as broken rather
 * than "not needed yet". Swap the strip for one quiet line instead of hiding the section, so Add a Remote stays
 * discoverable. Null before health has resolved, to avoid a premature flash.
 *
 * @param {{ hasUpstream?: boolean } | null | undefined} health
 * @returns {string|null} the quiet message to show, or null to show the normal button strip
 */
export function computeSyncActionsQuietMessage(health) {
  if (!health) {
    return null
  }
  const { update, publish } = computeRemoteGating(health)
  return update.disabled && publish.disabled
    ? 'Nothing to sync right now — use Add a Remote below to enable Update and Publish.'
    : null
}
```

3b. `src/gui/renderer/index.html`:
- Tile: `<span class="onboarding-tile-label">Get Data &amp; Sync</span>` becomes `<span class="onboarding-tile-label">Sync</span>`.
- Section heading `<h2 id="sync-data-title">Get Data &amp; Remote Sync</h2>` becomes `<h2 id="sync-data-title">Sync</h2>`.
- Lede: replace the paragraph text `Optional, secondary actions — download real file content, or sync with a remote/sibling copy of this project.` (it spans lines) with `Optional actions that sync this project with a remote or sibling copy, for example a server or another computer.`
- In `#sync-actions-strip` delete `<button id="get-data" ...>`, `<button id="drop-data" ...>` and the whole first `<span class="sibling-action-group">` (the one containing `unlock-files` and `unlock-info`). Keep the second group (Update, Publish, Disconnect, `sibling-actions-info`).
- In the `sibling-actions-info` `title`, replace `Save and Get Data already cover fully offline work.` with `Save already covers fully offline work.`
- Delete the `<p class="hint-inline">` paragraph that starts `If a file won't open in another program` (its advice now lives in the Files lede).

3c. `src/gui/renderer/app.js`:
- Delete the `getDataButton`, `dropDataButton` and `unlockFilesButton` entries from `elements` (also `unlockInfo` if an entry for `unlock-info` exists).
- Delete the three handlers `elements.getDataButton.addEventListener('click', ...)`, `elements.unlockFilesButton.addEventListener('click', ...)` and `elements.dropDataButton.addEventListener('click', ...)`.
- In `updateGetDataGating` delete the lines setting `getDataButton`, `unlockFilesButton` and `dropDataButton` `.disabled` / `.title`, and the `const unlockGating = computeUnlockGating(...)` line. Keep `const gating = ...` and `const dropGating = ...` (the toolbar lines from Task 2 use them).
- Remove `computeUnlockGating` from the `button-gating.js` import.
- In `updateSyncSectionVisibility` change `computeSyncActionsQuietMessage(classification, health)` to `computeSyncActionsQuietMessage(health)`.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS, no failures. If a failure mentions a leftover reference (`getDataButton`, `computeUnlockGating`), remove that reference; do not restore the old code.

- [ ] **Step 5: Commit**

```bash
git add src/gui/renderer test
git commit -m "feat: Sync tab keeps only the remote actions; file content actions live in Files

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: e2e and docs

**Files:**
- Modify: `e2e/button-gating.e2e.mjs`, `e2e/science-workflow.e2e.mjs`, `docs/product/researcher-workflow.md`

**Interfaces:**
- Consumes: ids `files-get-all`, `files-free-all`; row attributes `data-data-action`, `data-data-path`.

- [ ] **Step 1: Update `e2e/button-gating.e2e.mjs`**

Replace every `app.buttonState('get-data')` with `app.buttonState('files-get-all')`. Delete every line that reads `app.buttonState('unlock-files')` and every assertion on `unlock` (`assert.equal(unlock.disabled, ...)` and `assert.match(unlock.title, ...)`), in all four tests that have them. Update the first test title to `plain git project with no remote: Update, Publish, Get all all disabled` and mentions of "Get Data" in test titles and comments to "Get all" (the behaviour is the same: disabled for plain Git, disabled with "nothing to get" for a dataset without missing content).

- [ ] **Step 2: Update `e2e/science-workflow.e2e.mjs`**

Replace the test `Free Up Space removes the local copy now that the backup has one` with:

```js
test('Free up space on the file row removes the local copy now that the backup has one', async () => {
  const dropButton = '[data-data-action="drop"][data-data-path="data.bin"]'
  await app.page.evaluate(() => {
    window.confirm = () => true
    document.querySelector('[data-nav-target="files-panel"]').click()
  })
  await app.page.waitForSelector(dropButton)
  await app.page.evaluate((selector) => document.querySelector(selector).click(), dropButton)
  for (let i = 0; i < 100 && sh('git', ['annex', 'find', '--in', 'here', 'data.bin'], projectPath).trim() !== ''; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  assert.equal(sh('git', ['annex', 'find', '--in', 'here', 'data.bin'], projectPath).trim(), '', await commandOutput())
})
```

- [ ] **Step 3: Update `docs/product/researcher-workflow.md`**

Replace the two bullets

```
- **Get Data**
- **Free Up Space** (the counterpart of Get Data; only removes data another copy holds)
```

with

```
- **Get**, **Free up space** and **Unlock**, on the file and folder rows of the Files tab (Get fetches content; Free up space is its counterpart and only removes data another copy holds; Unlock makes an editable copy)
```

- [ ] **Step 4: Run the suites**

Run: `npm test`, then `npm run test:e2e`
Expected: unit suite PASS. The e2e suite needs Electron and git-annex; if this machine cannot launch it, say so in the report and do not claim e2e passes.

- [ ] **Step 5: Commit**

```bash
git add e2e docs/product/researcher-workflow.md
git commit -m "test: e2e and docs follow the unified Files-tab data actions

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage:** per-row table → Task 1 (+ rendering in Task 2); toolbar buttons → Task 2; behavior reuse (commands, confirmations, gating, refresh) → Task 2; removals and Sync rename → Task 3; tests, e2e, docs → Tasks 1–4. Manual-paths box untouched.
- **Deviations from the spec, both forced by the removal and small:** (1) row buttons are not gated, because a row only offers actions when `annexPresent` is non-null, which implies git-annex content; only the toolbar buttons use the gating rules. (2) `computeSyncActionsQuietMessage` loses its "or Get Data once files have missing content" wording and its dataset-gating condition, and `computeUnlockGating` is deleted as dead code, since the Sync tab no longer contains any file-content action.
- **Placeholders:** none. **Names:** `rowDataActions`, `runDataAction`, `files-get-all`, `files-free-all`, `data-data-action`, `data-data-path` are used identically in every task.
