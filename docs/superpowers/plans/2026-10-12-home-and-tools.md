# Home + Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the seven equal project tiles with one Home view (status, attention rows, Save, recent history) and a Tools view that holds every other panel.

**Architecture:** `#project-nav-group` keeps its id and now holds two siblings: `#project-home` (always the default) and `#project-tools` (hidden; a vertical list of the existing `.onboarding-tile` buttons plus the existing panels, unchanged). The tile list stays wired by `wireTileGroup`, with a new `required` option so exactly one tool is always selected. Attention rows come from one new pure function next to the existing health-chip logic.

**Tech Stack:** Electron renderer (plain ES modules, no framework), Node built-in test runner (`npm test`), Electron e2e via `npm run test:e2e`.

**Spec:** `docs/superpowers/specs/2026-10-12-home-and-tools-design.md`

## Global Constraints

- Zero new npm dependencies (Node/Electron built-ins only).
- TDD: failing test first, for every function and behaviour change. Tests run with `npm test`.
- No feature removed; every existing element id keeps its id and behaviour (e2e and unit tests depend on them).
- Home cards carry no emoji badges; tool icons live only in the Tools list.
- The tile named "Project Setup" becomes **Branches & Ignore**, "Time Machine" becomes **History**, "Health Details" becomes **Health**. The "Save Checkpoint" button text and panel are unchanged.
- Out of scope: the Open/Create onboarding screen, any change to what an action does, `docs/presentation-slides-de.md`.
- Before merging into `main`, run `ponytail:ponytail-audit` over the changes (CLAUDE.md).
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`

## Review Focus

- A project with no remote, no git-annex, or no health snapshot yet: no attention rows and no crash (unit-tested in Task 1).
- The Console or Sync list item becomes hidden while it is the selected tool: selection falls back to Files, never to nothing (Task 2 source test).
- Switching or opening another project while Tools is open: lands on Home (Task 2 source test).
- A validation message written to `#command-output` while "Details of last action" is collapsed must become visible, e.g. "Add a message before running Save" (Task 3 source test and manual check).
- Clicking an attention row whose underlying button is disabled (busy or gated) does nothing and does not throw (Task 3 source test).

## File Structure

- Modify `src/gui/renderer/project-health-chips.js`: add `computeAttentionRows`.
- Modify `src/gui/renderer/index.html`: new Home/Tools structure, status line into the strip, Tools/Back buttons, attention container, details wrapper.
- Modify `src/gui/renderer/styles.css`: vertical tools list, tools layout, attention rows.
- Modify `src/gui/renderer/app.js`: `wireTileGroup` option, `showTools`/`showHome`, attention rendering, details observer, remove health-card references.
- Create `test/home-tools-layout.test.js`: source-text tests (same style as `test/files-data-actions.test.js`).
- Modify `test/project-health-chips.test.js`: tests for `computeAttentionRows`.
- Modify `e2e/science-workflow.e2e.mjs`, `e2e/files-browser.e2e.mjs`: open Tools before using a tool; add the "Home needs no navigation" check.
- Modify `README.md`, `docs/tutorials/*.md`, `docs/product/researcher-workflow.md`.

---

### Task 1: `computeAttentionRows`

**Files:**
- Modify: `src/gui/renderer/project-health-chips.js` (append)
- Test: `test/project-health-chips.test.js` (append, and add the import)

**Interfaces:**
- Consumes: the health snapshot shape already used by `computeSyncStatusChip` / `computeMissingContentChip` (`annexSupported`, `missingContentCount`, `hasUpstream`, `ahead`, `behind`).
- Produces: `computeAttentionRows(health) -> Array<{ kind: 'missing'|'publish'|'update', count: number, label: string, action: string }>`, always in the order missing, publish, update; `[]` when nothing is actionable. Task 3 renders it.

- [ ] **Step 1: Write the failing tests**

Add `computeAttentionRows` to the import list at the top of `test/project-health-chips.test.js`, then append:

```js
test('attention rows: none when health is unknown or everything is fine', () => {
  assert.deepEqual(computeAttentionRows(null), [])
  assert.deepEqual(computeAttentionRows(undefined), [])
  assert.deepEqual(
    computeAttentionRows({ annexSupported: true, missingContentCount: 0, hasUpstream: true, upstream: 'origin/main', ahead: 0, behind: 0 }),
    []
  )
})

test('attention rows: missing data row, singular and plural', () => {
  assert.deepEqual(computeAttentionRows({ annexSupported: true, missingContentCount: 12 }), [
    { kind: 'missing', count: 12, label: '12 files not downloaded', action: 'Get all' }
  ])
  assert.equal(computeAttentionRows({ annexSupported: true, missingContentCount: 1 })[0].label, '1 file not downloaded')
})

test('attention rows: ignores a missing count when annex is not supported', () => {
  assert.deepEqual(computeAttentionRows({ annexSupported: false, missingContentCount: 5 }), [])
})

test('attention rows: publish and update rows from ahead/behind, in a fixed order', () => {
  const rows = computeAttentionRows({
    annexSupported: true, missingContentCount: 2, hasUpstream: true, upstream: 'origin/main', ahead: 2, behind: 1
  })
  assert.deepEqual(rows.map((row) => row.kind), ['missing', 'publish', 'update'])
  assert.equal(rows[1].label, '2 saves not published')
  assert.equal(rows[1].action, 'Publish')
  assert.equal(rows[2].label, '1 update available')
  assert.equal(rows[2].action, 'Update')
})

test('attention rows: no sync rows without an upstream or with unknown ahead/behind', () => {
  assert.deepEqual(computeAttentionRows({ hasUpstream: false, ahead: 3, behind: 3 }), [])
  assert.deepEqual(computeAttentionRows({ hasUpstream: true, upstream: 'origin/main', ahead: null, behind: undefined }), [])
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/project-health-chips.test.js`
Expected: FAIL (`computeAttentionRows` is not exported / not a function).

- [ ] **Step 3: Implement**

Append to `src/gui/renderer/project-health-chips.js`:

```js
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`

/**
 * The one-click "needs attention" rows on the Home view: only things the
 * researcher can fix with a single existing action. Empty when all is well.
 *
 * @param {{ annexSupported?: boolean, missingContentCount?: number|null, hasUpstream?: boolean, ahead?: number|null, behind?: number|null } | null | undefined} health
 * @returns {Array<{ kind: 'missing'|'publish'|'update', count: number, label: string, action: string }>}
 */
export function computeAttentionRows(health) {
  const rows = []
  if (health?.annexSupported && health.missingContentCount > 0) {
    const count = health.missingContentCount
    rows.push({ kind: 'missing', count, label: `${plural(count, 'file', 'files')} not downloaded`, action: 'Get all' })
  }
  if (health?.hasUpstream && health.ahead > 0) {
    rows.push({ kind: 'publish', count: health.ahead, label: `${plural(health.ahead, 'save', 'saves')} not published`, action: 'Publish' })
  }
  if (health?.hasUpstream && health.behind > 0) {
    rows.push({ kind: 'update', count: health.behind, label: `${plural(health.behind, 'update', 'updates')} available`, action: 'Update' })
  }
  return rows
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/project-health-chips.test.js`
Expected: PASS.

- [ ] **Step 5: Update the spec for the added `action` field and commit**

In `docs/superpowers/specs/2026-10-12-home-and-tools-design.md`, change `[{ kind: 'missing'|'publish'|'update', count, label }]` to `[{ kind: 'missing'|'publish'|'update', count, label, action }]`.

```bash
git add src/gui/renderer/project-health-chips.js test/project-health-chips.test.js docs/superpowers/specs/2026-10-12-home-and-tools-design.md
git commit -m "feat: computeAttentionRows for the Home view

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Tools view replaces the tile row

After this task the app works: Home shows the Save panel, **Tools ▸** opens the tool list, and the Save tile is gone. The Project Health card, attention rows and details wrapper come in Task 3.

**Files:**
- Create: `test/home-tools-layout.test.js`
- Modify: `src/gui/renderer/index.html`, `src/gui/renderer/styles.css`, `src/gui/renderer/app.js`
- Modify: `e2e/science-workflow.e2e.mjs:77,128`, `e2e/files-browser.e2e.mjs:38`

**Interfaces:**
- Produces (DOM ids): `#project-home`, `#project-tools`, `#open-tools`, `#close-tools`.
- Produces (JS in app.js): `DEFAULT_TOOL = 'files-panel'`, `showTools(target = DEFAULT_TOOL)`, `showHome()`, `loadTimeMachineIfEmpty()`, `wireTileGroup(tiles, datasetKey, { required })`. Task 3's "Full history ▸" calls `showTools('time-machine-zone')`.

- [ ] **Step 1: Write the failing source test**

Create `test/home-tools-layout.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../src/gui/renderer/index.html', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/gui/renderer/app.js', import.meta.url), 'utf8')
const at = (needle) => {
  const index = html.indexOf(needle)
  assert.notEqual(index, -1, `missing in index.html: ${needle}`)
  return index
}

test('Home holds Save; Tools holds every other panel', () => {
  const tools = at('id="project-tools"')
  assert.ok(at('id="project-home"') < at('id="save-checkpoint-panel"'))
  assert.ok(at('id="save-checkpoint-panel"') < tools, 'Save is on Home, before the Tools view')
  for (const id of ['power-user-console', 'sync-data-section', 'files-panel', 'project-health-panel', 'project-setup-zone', 'time-machine-zone']) {
    assert.ok(at(`id="${id}"`) > tools, `${id} is inside Tools`)
  }
})

test('Tools is hidden by default and has open and back buttons', () => {
  assert.match(html, /id="project-tools"[^>]*\bhidden\b/)
  at('id="open-tools"')
  at('id="close-tools"')
})

test('the Save tile is gone and the list items are renamed', () => {
  assert.doesNotMatch(html, /data-nav-target="save-checkpoint-panel"/)
  assert.doesNotMatch(html, /id="save-checkpoint-panel"[^>]*role="tabpanel"/)
  for (const label of ['Files', 'Sync', 'History', 'Health', 'Branches &amp; Ignore', 'Console']) {
    assert.match(html, new RegExp(`<span class="onboarding-tile-label">${label}</span>`), label)
  }
})

test('the project tool selection always falls back to Files, never to Save', () => {
  assert.doesNotMatch(app, /selectProjectTile\('save-checkpoint-panel'\)/)
  assert.match(app, /const DEFAULT_TOOL = 'files-panel'/)
  assert.match(app, /wireTileGroup\(elements\.projectNavTiles, 'navTarget', \{ required: true \}\)/)
})

test('opening or switching a project returns to Home', () => {
  const fn = app.slice(app.indexOf('function setProjectDependentSectionsVisible'))
  assert.match(fn.slice(0, fn.indexOf('\n}\n')), /showHome\(\)/)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/home-tools-layout.test.js`
Expected: FAIL (missing `id="project-home"`).

- [ ] **Step 3: Restructure `index.html`**

Work inside `<section id="project-nav-group" …>` (starts about line 282). Keep the section and its `hidden`.

1. Move the whole `<section id="save-checkpoint-panel" …>…</section>` block (from its opening tag to its closing `</section>` just before `<section id="sync-data-section"`) to the top of the group, wrapped:

```html
<div id="project-home">
  <!-- the save-checkpoint-panel block, moved here -->
</div>
```
In its opening tag remove `role="tabpanel"` and `hidden`.

2. Replace the old `<div class="onboarding-picker project-nav-picker …>…</div>` tile row with the Tools view, containing the tiles and then the remaining panels (power-user-console, sync-data-section, files-panel, project-health-panel, project-setup-zone, time-machine-zone) *unchanged*, in this shape:

```html
<div id="project-tools" hidden>
  <button id="close-tools" class="button button-ghost button-inline" type="button">← Back to project</button>
  <div class="tools-layout">
    <div class="onboarding-picker project-nav-picker tools-nav" role="tablist" aria-label="Project tools">
      <button type="button" class="onboarding-tile" data-nav-target="files-panel" role="tab" aria-selected="false" aria-controls="files-panel">
        <span class="onboarding-tile-icon" aria-hidden="true">🗂️</span>
        <span class="onboarding-tile-label">Files</span>
      </button>
      <button type="button" class="onboarding-tile" id="project-nav-tile-sync" data-nav-target="sync-data-section" role="tab" aria-selected="false" aria-controls="sync-data-section" hidden>
        <span class="onboarding-tile-icon" aria-hidden="true">🔄</span>
        <span class="onboarding-tile-label">Sync</span>
        <span id="sync-data-summary-hint" class="onboarding-tile-hint"></span>
      </button>
      <button type="button" class="onboarding-tile" data-nav-target="time-machine-zone" role="tab" aria-selected="false" aria-controls="time-machine-zone">
        <span class="onboarding-tile-icon" aria-hidden="true">⏳</span>
        <span class="onboarding-tile-label">History</span>
      </button>
      <button type="button" class="onboarding-tile" data-nav-target="project-health-panel" role="tab" aria-selected="false" aria-controls="project-health-panel">
        <span class="onboarding-tile-icon" aria-hidden="true">🩺</span>
        <span class="onboarding-tile-label">Health</span>
      </button>
      <button type="button" class="onboarding-tile" data-nav-target="project-setup-zone" role="tab" aria-selected="false" aria-controls="project-setup-zone">
        <span class="onboarding-tile-icon" aria-hidden="true">🌿</span>
        <span class="onboarding-tile-label">Branches &amp; Ignore</span>
      </button>
      <button type="button" class="onboarding-tile" id="project-nav-tile-console" data-nav-target="power-user-console" role="tab" aria-selected="false" aria-controls="power-user-console" hidden>
        <span class="onboarding-tile-icon" aria-hidden="true">🖥️</span>
        <span class="onboarding-tile-label">Console</span>
      </button>
    </div>
    <div class="tools-panels">
      <!-- power-user-console, sync-data-section, files-panel, project-health-panel, project-setup-zone, time-machine-zone -->
    </div>
  </div>
</div>
```

3. In `#project-strip`, inside `.strip-state-group`, add before the Switch Project button:

```html
<button id="open-tools" class="button button-ghost button-inline" type="button">Tools ▸</button>
```

4. Rename the heading text in `#setup-zone-title` to `Branches &amp; Ignore Rules`; leave other headings.

- [ ] **Step 4: CSS**

Append to `src/gui/renderer/styles.css`:

```css
.tools-layout {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
  margin-top: 12px;
}

.onboarding-picker.project-nav-picker.tools-nav {
  grid-template-columns: 1fr;
  gap: 8px;
}

.tools-nav .onboarding-tile {
  grid-auto-flow: column;
  justify-content: start;
  justify-items: start;
  align-items: center;
  padding: 10px 14px;
  border-radius: 12px;
}

.tools-nav .onboarding-tile-icon {
  font-size: 1.3rem;
}

.tools-nav .onboarding-tile-label {
  font-size: 0.95rem;
}

.tools-nav .onboarding-tile-hint {
  display: none;
}

.tools-panels {
  display: grid;
  gap: 16px;
  min-width: 0;
}

@media (max-width: 800px) {
  .tools-layout {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: `app.js`**

a) Elements (next to `projectNavGroup`, ~line 132):

```js
  projectHome: document.getElementById('project-home'),
  projectTools: document.getElementById('project-tools'),
  openToolsButton: document.getElementById('open-tools'),
  closeToolsButton: document.getElementById('close-tools'),
```

b) `wireTileGroup`: change the signature to `function wireTileGroup(tiles, datasetKey, { required = false } = {})`, update its comment ("clicking the already-open tile closes it, unless `required`: the project Tools list always keeps one tool selected"), and replace the click handler body:

```js
      if (tile.hidden) {
        return
      }
      const alreadySelected = tile.getAttribute('aria-selected') === 'true'
      if (alreadySelected && required) {
        return
      }
      select(alreadySelected ? null : tile.dataset[datasetKey])
```

c) Replace line 520 and add the helpers right after it:

```js
const selectProjectTile = wireTileGroup(elements.projectNavTiles, 'navTarget', { required: true })
const DEFAULT_TOOL = 'files-panel'

function showHome() {
  elements.projectTools.hidden = true
  elements.projectHome.hidden = false
}

function showTools(target = DEFAULT_TOOL) {
  elements.projectHome.hidden = true
  elements.projectTools.hidden = false
  selectProjectTile(target)
  if (target === 'time-machine-zone') {
    loadTimeMachineIfEmpty()
  }
}

elements.openToolsButton.addEventListener('click', () => showTools())
elements.closeToolsButton.addEventListener('click', showHome)
```

d) Replace the three `selectProjectTile('save-checkpoint-panel')` calls: the Sync and Console fallbacks (`updateSyncSectionVisibility`, `updatePowerUserConsoleVisibility`) become `selectProjectTile(DEFAULT_TOOL)`. In `setProjectDependentSectionsVisible`, replace `selectProjectTile('save-checkpoint-panel')` with `showHome()`.

e) Extract the Time Machine tile listener (~line 1222) body into a function and reuse it:

```js
async function loadTimeMachineIfEmpty() {
  const projectPath = readProjectPath()
  if (!projectPath || state.timeMachineCommits.length > 0) {
    return
  }
  await refreshTimeMachineHistory(projectPath)
}

elements.projectNavTiles
  .find((tile) => tile.dataset.navTarget === 'time-machine-zone')
  ?.addEventListener('click', loadTimeMachineIfEmpty)
```

Also update the comment above `setProjectDependentSectionsVisible` (it describes "click-to-reveal tiles… default back to the Save Checkpoint tile") to describe Home + Tools.

- [ ] **Step 6: Run unit tests**

Run: `npm test`
Expected: all PASS, including `test/home-tools-layout.test.js` and `test/files-data-actions.test.js` (its Sync tile check still matches).

- [ ] **Step 7: Fix the e2e navigation**

In `e2e/science-workflow.e2e.mjs` line 77 and line 128, prefix the evaluate body with `document.getElementById('open-tools').click()` before the `[data-nav-target=…]` click. In `e2e/files-browser.e2e.mjs` line 38 insert `await app.page.click('#open-tools')` before the existing `app.page.click('[data-nav-target="files-panel"]')`; clicking Files after Tools opened is already selected, so that second click is a no-op by design. Delete the now-redundant second click.

Add to `e2e/science-workflow.e2e.mjs`, directly after the `test.after` block:

```js
test('Home shows Save and recent history with no navigation; Tools is closed', async () => {
  const visible = (id) => app.page.evaluate((elementId) => document.getElementById(elementId).offsetParent !== null, id)
  assert.equal(await visible('save-project'), true)
  assert.equal(await visible('recent-commits-output'), true)
  assert.equal(await visible('project-tools'), false)
})
```

- [ ] **Step 8: Run the touched e2e files and look at the app**

Run: `env -u ELECTRON_RUN_AS_NODE node --test --test-concurrency=1 e2e/science-workflow.e2e.mjs e2e/files-browser.e2e.mjs`
Expected: PASS (needs real `datalad` and `git-annex`; if they are missing locally, say so and leave these for CI).
Then use the `run` skill to launch the app: open a project, confirm Home shows Save, click **Tools ▸** (Files selected, list on the left), pick each tool, press **← Back to project**. Check the layout at a narrow window width too.

- [ ] **Step 9: Commit**

```bash
git add test/home-tools-layout.test.js src/gui/renderer e2e
git commit -m "feat: Home view with a Tools list replaces the tile row

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Status in the strip, attention rows, history link, collapsed last action

**Files:**
- Modify: `test/home-tools-layout.test.js` (append)
- Modify: `src/gui/renderer/index.html`, `src/gui/renderer/styles.css`, `src/gui/renderer/app.js`

**Interfaces:**
- Consumes: `computeAttentionRows` (Task 1), `showTools` (Task 2).
- Produces: DOM `#attention-rows`, `#history-full-link`, `#last-action-details`.

- [ ] **Step 1: Append the failing source tests**

```js
test('the health status line lives in the project strip and the Health card is gone', () => {
  const strip = html.slice(at('id="project-strip"'), at('id="running-commands"'))
  assert.match(strip, /id="project-status-line"/)
  assert.doesNotMatch(html, /id="project-health-card"/)
  assert.doesNotMatch(app, /projectHealthCard/)
})

test('Home order: merge banner, attention rows, Save, then recent history', () => {
  assert.ok(at('id="merge-banner"') < at('id="attention-rows"'))
  assert.ok(at('id="attention-rows"') < at('id="save-project"'))
  assert.ok(at('id="save-project"') < at('id="recent-commits-output"'))
  assert.ok(at('id="merge-banner"') < at('id="project-tools"'))
})

test('Home cards carry no emoji badge', () => {
  const home = html.slice(at('id="project-home"'), at('id="project-tools"'))
  assert.doesNotMatch(home, /card-icon-badge/)
})

test('Full history jumps to Tools, History', () => {
  at('id="history-full-link"')
  assert.match(app, /historyFullLink\.addEventListener\('click', \(\) => showTools\('time-machine-zone'\)\)/)
})

test('attention rows come from computeAttentionRows and act through the existing buttons', () => {
  assert.match(app, /computeAttentionRows\(health\)/)
  assert.match(app, /missing: elements\.filesGetAllButton/)
  assert.match(app, /publish: elements\.publishProjectButton/)
  assert.match(app, /update: elements\.updateProjectButton/)
  assert.match(app, /button\.disabled/)
})

test('the last action result is collapsed but opens itself when something is written', () => {
  at('id="last-action-details"')
  assert.match(app, /new MutationObserver\([^)]*\)\.observe\(elements\.commandOutput/s)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/home-tools-layout.test.js`
Expected: FAIL on the new tests.

- [ ] **Step 3: `index.html`**

1. Delete the whole `<section id="project-health-card" …>…</section>`. Move its status paragraph into `.project-strip-identity`, under `#current-project-nested-info` (keep id and classes):

```html
<p id="project-status-line" class="status-line status-line-neutral">
  Select a project to see its save, sync, and data status.
</p>
```
2. Move `<section id="merge-banner" …>` out of the Save panel to the first child of `#project-home`, and add `card` to its class (`class="card status-box"`). Right after it add `<div id="attention-rows" class="attention-rows" hidden></div>`.
3. Remove `<span class="card-icon-badge" …>💾</span>` from the Save panel.
4. In the "Recent Commits" section head, add after the `<h3>`:

```html
<button id="history-full-link" class="button button-ghost button-inline" type="button">Full history ▸</button>
```
5. Wrap the "Last Action Result" `<section class="status-box">` in `<details id="last-action-details" class="branch-details"><summary>Details of last action</summary> … </details>` (keep the inner section, `#command-output` and its text).

- [ ] **Step 4: CSS** (append)

```css
.attention-rows {
  display: grid;
  gap: 8px;
}

.attention-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid rgba(168, 110, 11, 0.4);
  border-radius: 12px;
  background: var(--teal-soft);
}
```
Delete the now-unused `.project-health` rule.

- [ ] **Step 5: `app.js`**

a) Remove the `projectHealthCard` element entry and the `elements.projectHealthCard.hidden = !visible` line. Add `computeAttentionRows` to the `project-health-chips.js` import. Add elements `attentionRows: document.getElementById('attention-rows')`, `historyFullLink: document.getElementById('history-full-link')`, `lastActionDetails: document.getElementById('last-action-details')`.

b) Add near the other Home wiring (after `showTools`):

```js
elements.historyFullLink.addEventListener('click', () => showTools('time-machine-zone'))

// Validation messages go to #command-output too, so a collapsed details must open when anything is written.
new MutationObserver(() => {
  elements.lastActionDetails.open = true
}).observe(elements.commandOutput, { childList: true, characterData: true, subtree: true })

function renderAttentionRows(health) {
  const buttonFor = {
    missing: elements.filesGetAllButton,
    publish: elements.publishProjectButton,
    update: elements.updateProjectButton
  }
  const rows = computeAttentionRows(health)
  elements.attentionRows.hidden = rows.length === 0
  elements.attentionRows.innerHTML = rows
    .map(
      (row) => `<div class="attention-row"><span>${escapeHtml(row.label)}</span>` +
        `<button class="button button-ghost button-inline" type="button" data-attention="${row.kind}">${escapeHtml(row.action)}</button></div>`
    )
    .join('')
  elements.attentionRows.querySelectorAll('button[data-attention]').forEach((rowButton) => {
    const button = buttonFor[rowButton.dataset.attention]
    rowButton.disabled = button.disabled
    rowButton.title = button.title
    rowButton.addEventListener('click', () => button.click())
  })
}
```

c) In `renderProjectHealth`: call `renderAttentionRows(null)` in both early-return branches (override message, and `!health`), and `renderAttentionRows(health)` after `applyRemoteGatedButtons(health)` for the normal path. Place the normal-path call after `applyRemoteGatedButtons` so the mirrored `disabled` state is current.

Note `renderAttentionRows` reads `button.disabled` once per render; that matches the other buttons, which are re-gated on the same renders. If a row's button gets disabled later (busy), `button.click()` on a disabled button is a no-op, so nothing throws.

- [ ] **Step 6: Run unit tests**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 7: Check in the real app**

Use the `run` skill. Open a project with unsaved files, missing annexed content and a remote that is ahead; confirm the strip shows the status line, the rows appear and each acts (Get all / Publish / Update), the merge banner sits above them, **Full history ▸** lands on Tools → History, and clicking Save with an empty message opens "Details of last action" with the hint. Run `env -u ELECTRON_RUN_AS_NODE node --test --test-concurrency=1 e2e/science-workflow.e2e.mjs e2e/files-browser.e2e.mjs` again.

- [ ] **Step 8: Commit**

```bash
git add test/home-tools-layout.test.js src/gui/renderer
git commit -m "feat: status in the strip, attention rows, full-history link, collapsed last action

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Docs and merge readiness

**Files:**
- Modify: `README.md:40,44`, `docs/tutorials/03-team-feature-branches.md`, `04-multimodal-project.md`, `05-longitudinal-multisite.md`, `06-publication-freeze-release.md`, `00-create-first-project.md:48`, `docs/tutorials/README.md:13`, `docs/product/researcher-workflow.md:43`

- [ ] **Step 1: Update wording**

Replace in those files (grep each first, change only the user-facing tile references):
- `Project Setup → Branch` becomes `Tools → Branches & Ignore → Branch`; bare "Project Setup" becomes "Tools → Branches & Ignore".
- "Time Machine" (as a place to click) becomes "Tools → History"; keep it where it names the history feature in prose.
- `Health Details` / "Project Health offers" becomes "Tools → Health".
- `00-create-first-project.md:48`: the alt text "project navigation tiles" becomes "Home view with the Tools button".
- README line 44: "an optional "Project Setup" area" becomes "under Tools".

Screenshots under `docs/_static/screenshots` show the old tile row and cannot be regenerated here; list them in the PR description as stale.

- [ ] **Step 2: Verify and commit**

Run: `npm test` (the docs tests such as `test/docs-link.test.js` must still pass).

```bash
git add README.md docs
git commit -m "docs: describe the Home view and Tools paths

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Audit before merge**

Run the `ponytail:ponytail-audit` skill over the branch diff, handle or consciously decline each finding, then open the PR into `main`.
