# Round 1 Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove manual file paths and the command console, use one "save" vocabulary, slim the header when a project is open, suggest a save message, and add a "Continue with <project>" button on the start screen.

**Architecture:** Mostly deletions and renames in the renderer (`app.js`, `index.html`, `styles.css`) and main process (`main.js`, `preload.js`, `policy.js`). One new pure module (`message-suggestion.js`, unit-tested). Everything else is checked with the repo's source-text test style (`test/home-tools-layout.test.js` pattern) plus the existing e2e files.

**Tech Stack:** Electron renderer (plain ES modules), Node built-in test runner (`npm test`), e2e via `npm run test:e2e` (needs `env -u ELECTRON_RUN_AS_NODE`).

**Spec:** `docs/superpowers/specs/2026-10-12-cleanup-round1-design.md`

## Global Constraints

- Zero new npm dependencies; no new IPC channels (this round only removes some).
- TDD for every change: failing test first. Source-text tests count (repo pattern).
- Branch `feat/round1-cleanup` is stacked on `feat/home-and-tools` (PR #25). Open the PR against `feat/home-and-tools` until #25 merges, then retarget to `main`.
- Existing element ids stay (`save-checkpoint-panel`, `recent-commits-output`, `last-commit-meta`, …); only user-visible text changes.
- Vocabulary: the action is **Save**, a recorded state is a **save**, a marked one is a **version**. Never "checkpoint" or "commit" in UI text or docs (code comments, ids, test data and raw git/DataLad output are exempt).
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- Before merge into `main`, run `ponytail:ponytail-audit` over the changes (CLAUDE.md).
- Ruling carried from the maintainer (2026-10-12): the console is removed **now**, and its three cancel e2e tests (`e2e/cancel.e2e.mjs`) are dropped with it. Round 4 (`datalad run` popup) must add cancel e2e tests back, using a recorded run as the slow command.

## Review Focus

- An older install left `dataladDesktop.powerUserMode = '1'` in localStorage: the app starts normally, no console, no errors (Task 2).
- An old `policy.json` still containing `consoleDisabled`, or an unreadable one: `loadPolicy` ignores the key and still honours `trustedRoots` (Task 2).
- Save with an empty message still auto-generates "save <date> <time>"; the suggestion is never sent unless the user clicked "Use suggestion" (Tasks 3 and 5).
- Continue button: hidden with no recent projects and after "Clear"; with a missing folder the existing error shows and nothing stays busy (Task 6).
- Slim header: Setup and Docs still work with a project open, and "Switch Project" brings the full hero back (Task 4).
- `suggestMessage` with nested paths, spaces/unicode names and mixed statuses (Task 5).

## File Structure

- Create `src/gui/renderer/message-suggestion.js`, `test/message-suggestion.test.js`, `test/round1-cleanup.test.js` (source-text tests for markup and wiring).
- Modify `src/gui/renderer/{app.js,index.html,styles.css,save-gating.js,project-health-chips.js}`, `src/gui/{main.js,preload.js,policy.js}`.
- Delete `src/datalad/console-command.js`, `src/gui/console-consent.js`, `test/console-command.test.js`, `test/console-consent.test.js`, `e2e/console-gate.e2e.mjs`, `e2e/console-policy.e2e.mjs`, `e2e/cancel.e2e.mjs`.
- Modify tests that mention the removed things: `test/{policy,trust-wiring,security-doc,save-gating,docs-link,home-tools-layout,project-health-chips}.test.js`, `e2e/{real-annex-roundtrip,git-identity,busy-state,electron-driver}.e2e.mjs`.
- Docs: `README.md`, `SECURITY.md`, `CHANGELOG.md`, `docs/roadmap.md`, `docs/product/researcher-workflow.md`, `docs/tutorials/*`.

---

### Task 1: Remove "manual file paths" from Save

**Files:**
- Create: `test/round1-cleanup.test.js`
- Modify: `src/gui/renderer/index.html` (the `<details class="branch-details">` around `#paths`, ~line 345), `src/gui/renderer/app.js` (`elements.paths` entry, the `input` listener ~line 408, `parsePaths` ~line 2664, `gatherSavePaths` ~line 2946), `src/gui/renderer/save-gating.js`, `test/save-gating.test.js`

**Interfaces:**
- Produces: `gatherSavePaths()` returns only the checked files. Guidance text for "changes but no selection" becomes `Select changed files before saving.`

- [ ] **Step 1: Write the failing tests**

Create `test/round1-cleanup.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const html = read('src/gui/renderer/index.html')
const app = read('src/gui/renderer/app.js')

test('Save no longer has manual file paths', () => {
  assert.doesNotMatch(html, /id="paths"/)
  assert.doesNotMatch(html, /manual file paths/i)
  assert.doesNotMatch(app, /elements\.paths|parsePaths/)
})
```

In `test/save-gating.test.js`, find the assertion on the text `'Select changed files or add manual paths before saving.'` and change it to `'Select changed files before saving.'` (grep the file for `manual paths`).

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/round1-cleanup.test.js test/save-gating.test.js`
Expected: FAIL (`id="paths"` still present; gating text differs).

- [ ] **Step 3: Implement**

- `index.html`: delete the whole `<details class="branch-details"> <summary>Advanced: manual file paths</summary> … </details>` block that contains `#paths`.
- `app.js`: delete the `paths: document.getElementById('paths'),` element entry, the `elements.paths.addEventListener('input', …)` block, the `parsePaths` function, and change `gatherSavePaths` to:

```js
function gatherSavePaths() {
  return [...state.selectedChangedPaths]
}
```
- `save-gating.js`: change the text to `'Select changed files before saving.'`.

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: all PASS. If another test referenced `parsePaths` or `#paths`, update it to match the spec (Save sends exactly the checked files).

- [ ] **Step 5: Commit**

```bash
git add -A src test
git commit -m "feat: remove manual file paths from Save

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Remove the command console and Power user mode

**Files:**
- Modify: `test/round1-cleanup.test.js`, `src/gui/renderer/{index.html,app.js,styles.css}`, `src/gui/{main.js,preload.js,policy.js}`, `test/{policy,trust-wiring,security-doc,docs-link,home-tools-layout}.test.js`, `e2e/electron-driver.mjs`, `SECURITY.md`
- Delete: `src/datalad/console-command.js`, `src/gui/console-consent.js`, `test/console-command.test.js`, `test/console-consent.test.js`, `e2e/console-gate.e2e.mjs`, `e2e/console-policy.e2e.mjs`, `e2e/cancel.e2e.mjs`

**Interfaces:**
- Produces: `loadPolicy({ env, files })` returns `{ trustedRoots }` only. The Tools list has five items (Files, Sync, History, Health, Branches & Ignore).

- [ ] **Step 1: Write the failing tests**

Append to `test/round1-cleanup.test.js`:

```js
const main = read('src/gui/main.js')
const preload = read('src/gui/preload.js')

test('the console and Power user mode are gone from the UI', () => {
  for (const id of ['power-user-console', 'project-nav-tile-console', 'power-user-mode-toggle', 'console-run', 'console-command']) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`), id)
  }
  assert.doesNotMatch(html, /Power user mode|Power User Console/i)
  assert.doesNotMatch(app, /powerUser|PowerUser|POWER_USER|consoleRunButton|runConsoleCommand|setConsoleEnabled|consoleHistory/)
})

test('the console is gone from the main process, preload and policy', () => {
  assert.doesNotMatch(main, /console:setEnabled|console:runCommand|buildConsoleCommand|createConsoleConsent|consoleEnabled/)
  assert.doesNotMatch(preload, /runConsoleCommand|setConsoleEnabled/)
  for (const file of ['src/datalad/console-command.js', 'src/gui/console-consent.js', 'test/console-command.test.js', 'test/console-consent.test.js', 'e2e/console-gate.e2e.mjs', 'e2e/console-policy.e2e.mjs', 'e2e/cancel.e2e.mjs']) {
    assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), false, file)
  }
})

test('SECURITY.md no longer documents a console', () => {
  const security = read('SECURITY.md')
  assert.doesNotMatch(security, /DISABLE_CONSOLE|consoleDisabled|Command console/)
})
```

In `test/policy.test.js`, rewrite to the new contract (delete the console tests, keep trusted-roots tests):

```js
test('loadPolicy has no trusted roots by default', () => {
  assert.deepEqual(loadPolicy({ env: {}, files: ['/nonexistent/policy.json'] }), { trustedRoots: [] })
})

test('loadPolicy ignores keys it does not know, such as the old consoleDisabled', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'policy-'))
  const file = join(dir, 'policy.json')
  await writeFile(file, JSON.stringify({ consoleDisabled: true, trustedRoots: ['/lab/share'] }))
  assert.deepEqual(loadPolicy({ env: {}, files: [file] }), { trustedRoots: ['/lab/share'] })
})

test('loadPolicy: an unreadable policy file contributes no trusted roots', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'policy-'))
  const file = join(dir, 'policy.json')
  await writeFile(file, '{ not json')
  assert.deepEqual(loadPolicy({ env: {}, files: [file] }), { trustedRoots: [] })
})
```
Keep the file's existing imports and any existing trusted-roots tests that do not mention `consoleDisabled`; delete every test that asserts `consoleDisabled`. (Read the file first and keep its helpers.)

In `test/trust-wiring.test.js`: delete the test "turning the console on goes through the native consent…" and remove `'console:setEnabled'` from the `noFolder` list.

In `test/security-doc.test.js`: delete the assertions on `DATALAD_DESKTOP_DISABLE_CONSOLE` (read the file; if the whole test only checks that, delete the test).

In `test/docs-link.test.js` (test "Power user mode and Auto-nest BIDS live in Setup, not the header"): change it to check only `bids-auto-nest-toggle` and rename it "Auto-nest BIDS lives in Setup, not the header".

In `test/home-tools-layout.test.js`: the label loop `['Files', 'Sync', 'History', 'Health', 'Branches &amp; Ignore', 'Console']` loses `'Console'`; the panel list `['power-user-console', 'sync-data-section', …]` loses `'power-user-console'`.

- [ ] **Step 2: Run to verify failure**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)|^✖"`
Expected: FAIL (console ids and files still exist; policy still returns `consoleDisabled`).

- [ ] **Step 3: Delete the console**

```bash
git rm src/datalad/console-command.js src/gui/console-consent.js test/console-command.test.js test/console-consent.test.js e2e/console-gate.e2e.mjs e2e/console-policy.e2e.mjs e2e/cancel.e2e.mjs
```

Edit by hand (use `grep -n -i "console" <file>` to find every hit):
- `main.js`: remove the two imports (`buildConsoleCommand`, `createConsoleConsent`), the `let consoleEnabled` block with its comment, the `consoleConsent` factory and the `consentStore` variable it uses, and both `handle('console:…')` blocks. **Keep** `const consoleRunner = new ProcessRunner()`: it is the shared runner used by many handlers (leave the name; renaming is churn).
- `preload.js`: remove `runConsoleCommand` and `setConsoleEnabled`.
- `policy.js`: remove `consoleDisabled` and the env var; `loadPolicy` returns `{ trustedRoots: [...trustedRoots] }`. The `catch` block keeps `continue`. Update the file's top comment (admin-controlled trusted roots only).
- `index.html`: remove the `#project-nav-tile-console` button, the whole `<section id="power-user-console" …>` panel, and the "Power user mode" `<label class="power-toggle-wrap" for="power-user-mode-toggle">` in Setup → Preferences.
- `app.js`: remove `MAX_CONSOLE_HISTORY`, `consoleHistory` state, `POWER_USER_MODE_STORAGE_KEY`, the console and `powerUserModeToggle` element entries, the `initPowerUserConsole()` call and function, `updatePowerUserConsoleVisibility` (and its call in `setProjectDependentSectionsVisible`), `runConsoleCommand`, `renderConsoleResult`, `rememberConsoleCommand`, `renderConsoleHistory`. `applyWorkTerminology` and `getMessageTermLabel` read `powerUserModeToggle`: replace their power-user branches with the plain wording **for now** (Task 3 deletes them): `getMessageTermLabel` returns `'checkpoint message'`, and `applyWorkTerminology` uses `'Save a Checkpoint'`, `'Checkpoint Message'`, `'Save Checkpoint'`.
- `styles.css`: `grep -n -i "console" src/gui/renderer/styles.css` and delete those rules. Keep `.power-toggle-wrap` (the BIDS toggle still uses it).
- `e2e/electron-driver.mjs`: update the comments that mention the console or Power User Mode (lines ~28-36) so they no longer claim a console toggle exists.
- `SECURITY.md`: delete the **Command console** section and every sentence that mentions `consoleDisabled`, `DATALAD_DESKTOP_DISABLE_CONSOLE` or the console (lines ~53-55, 74-76, 97, 110). Keep the `trustedRoots` sentence, now without "in the same `policy.json` as `consoleDisabled`".

- [ ] **Step 4: Run to verify pass**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖"`
Expected: PASS. Fix any test that still imports a deleted module (`grep -rn "console-command\|console-consent" test e2e`).

- [ ] **Step 5: e2e smoke**

Run: `env -u ELECTRON_RUN_AS_NODE node --test --test-concurrency=1 e2e/science-workflow.e2e.mjs e2e/files-browser.e2e.mjs e2e/busy-state.e2e.mjs`
Expected: PASS (`busy-state` may fail only if it depends on the console; if so, read it and port its slow command to a normal action or drop that case, and write a `Ruling:` line in the ledger).

- [ ] **Step 6: Commit**

```bash
git add -A src test e2e SECURITY.md
git commit -m "feat: remove the command console and Power user mode

The console duplicated the terminal and was the largest security surface.
Its three cancel e2e tests go with it; round 4 re-adds cancel coverage on
top of the datalad run popup.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: One vocabulary: save / saved version

**Files:**
- Modify: `test/round1-cleanup.test.js`, `test/{save-gating,project-health-chips}.test.js`, `src/gui/renderer/{index.html,app.js,save-gating.js,project-health-chips.js}`, `e2e/{real-annex-roundtrip,git-identity,busy-state}.e2e.mjs`

**Interfaces:**
- Consumes: Task 2 left `getMessageTermLabel`/`applyWorkTerminology` returning plain checkpoint wording.
- Produces: no function accepts `messageLabel` any more; the Save button text is exactly `Save`.

- [ ] **Step 1: Write the failing tests**

Append to `test/round1-cleanup.test.js`:

```js
test('the UI text says save, never checkpoint or commit', () => {
  // Ids, classes and other attributes are exempt; visible text, titles and placeholders are not.
  const visible = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s(?:id|class|for|aria-labelledby|aria-controls|data-[\w-]+|role|type|href|src|alt)="[^"]*"/g, '')
  assert.doesNotMatch(visible, /checkpoint|\bcommits?\b/i)
})

test('user-facing strings in app.js and the pure helpers say save', () => {
  const chips = read('src/gui/renderer/project-health-chips.js')
  const gating = read('src/gui/renderer/save-gating.js')
  assert.doesNotMatch(app, /Latest commit|Last commit|No commits yet|recent commits'|`checkpoint |Save a Checkpoint|Checkpoint Message|Save Checkpoint/)
  assert.doesNotMatch(app, /getMessageTermLabel|applyWorkTerminology/)
  assert.doesNotMatch(chips + gating, /checkpoint|messageLabel/i)
  assert.match(app, /Last saved \$\{relativeAge\}/)
  assert.match(app, /return `save \$\{date\} \$\{time\}`/)
})
```

In `test/save-gating.test.js` change the expected text `'Add a checkpoint message, or Save will ask you for one.'` to `'Add a message, or Save will ask you for one.'` and delete the test "messageLabel lets callers swap in git terminology for power users".
In `test/project-health-chips.test.js` (lines ~90 and ~94) change `save a checkpoint when ready.` to `save when ready.`.

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/round1-cleanup.test.js test/save-gating.test.js test/project-health-chips.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

`index.html` (visible text only; keep ids):
- Panel title `Save a Checkpoint` → `Save`; the lede below it → `Write down what you've done and save your files. This is the action you'll use most, and it works fully offline.`
- `<span id="message-field-label">Checkpoint Message</span>` → `Message`; placeholder `Describe this checkpoint` → `Describe what you changed`.
- `#save-guidance` initial text → `Add a message, or Save will ask you for one.`
- Save button text `Save Checkpoint` → `Save`; its `title` → `Save the current state of your files with a message. Works fully offline.`
- `Recent Commits` → `Recent saves`.
- Setup/identity copy: `Saved checkpoints are labelled with who made them.` → `Saves are labelled with who made them.`; `stored with every checkpoint you save` → `stored with every save`.
- The header meta placeholder text `Last commit status appears here after selecting a project.` → `Last save status appears here after selecting a project.`
- Any remaining match from `grep -n -i "checkpoint\|commit" src/gui/renderer/index.html`, except inside id/class/for attributes.

`app.js`:
- Delete `getMessageTermLabel`, `applyWorkTerminology`, its call sites, and `messageLabel: getMessageTermLabel(),` in `updateSaveButtonState`. Keep `setIdleButtonLabel` only if still used elsewhere (`grep -n setIdleButtonLabel`); delete it otherwise.
- `buildQuickSaveMessage` returns `` `save ${date} ${time}` ``.
- `Saved ${fileSummary}. Latest commit:${hashSummary}.` → ``Saved ${fileSummary}. Latest save:${hashSummary}.``
- Last-save meta: `Last commit ${relativeAge}${suffix}.` → `Last saved ${relativeAge}${suffix}.`; `No commits yet in this project.` (both places) → `No saves yet in this project.`; `Last commit status unavailable.` → `Last save status unavailable.`; `Select a project to see last commit status.` → `Select a project to see the last save.`; tooltip `Last commit message:` → `Last save message:`.
- `Could not load recent commits:` → `Could not load recent saves:`.

`save-gating.js`: remove the `messageLabel` parameter and doc lines; guidance text `Add a message, or Save will ask you for one.`
`project-health-chips.js`: `save a checkpoint when ready` → `save when ready`.
e2e: in `real-annex-roundtrip`, `busy-state` (two places) and `git-identity`, change the expected button text `'Save Checkpoint'` (and `'Commit'` if present) to `'Save'`. Update the stale comment in `electron-driver.mjs` that names `'Commit'` vs `'Save Checkpoint'`.

- [ ] **Step 4: Run to verify pass**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖"` then `env -u ELECTRON_RUN_AS_NODE node --test --test-concurrency=1 e2e/busy-state.e2e.mjs e2e/git-identity.e2e.mjs e2e/real-annex-roundtrip.e2e.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src test e2e
git commit -m "feat: one vocabulary, save and saved version

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Slim header when a project is open

**Files:**
- Modify: `test/round1-cleanup.test.js`, `src/gui/renderer/{index.html,app.js,styles.css}`

**Interfaces:**
- Produces: `<header id="app-header" class="hero …">` gets class `hero-slim` while a project is open; `#last-commit-meta` lives inside `#project-strip`.

- [ ] **Step 1: Write the failing tests**

Append to `test/round1-cleanup.test.js`:

```js
test('the header is slim while a project is open and the last-save line sits in the project strip', () => {
  assert.match(html, /<header id="app-header" class="hero /)
  const strip = html.slice(html.indexOf('id="project-strip"'), html.indexOf('id="running-commands"'))
  assert.match(strip, /id="last-commit-meta"/)
  assert.doesNotMatch(html.slice(0, html.indexOf('id="project-strip"')), /id="last-commit-meta"/)
  const fn = app.slice(app.indexOf('function setProjectDependentSectionsVisible'))
  assert.match(fn.slice(0, fn.indexOf('\n}\n')), /appHeader\.classList\.toggle\('hero-slim', visible\)/)
  assert.match(read('src/gui/renderer/styles.css'), /\.hero-slim h1/)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/round1-cleanup.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `index.html`: change `<header class="hero card reveal reveal-1">` to `<header id="app-header" class="hero card reveal reveal-1">`. Move the `<p id="last-commit-meta" class="hero-meta hero-meta-idle">…</p>` out of the header and into `.project-strip-identity`, right after `#project-status-line`.
- `app.js`: add `appHeader: document.getElementById('app-header'),` to `elements`, and in `setProjectDependentSectionsVisible` add `elements.appHeader.classList.toggle('hero-slim', visible)`.
- `styles.css` (append):

```css
.hero-slim h1,
.hero-slim .lede {
  display: none;
}

.hero-slim .hero-logo {
  height: 36px;
  width: auto;
}
```
Then run the app (use the `run` skill, or a scratch script like the earlier `shot.mjs`), open a project, take a screenshot, and adjust spacing so the header is one slim row (the existing `.hero` has `position:absolute` children and padding; trim `.hero-slim` padding and the logo frame until the header is about 60px tall). `.hero-meta` rules use `position`/`max-width` for the old spot: reset them under `.project-strip-identity .hero-meta` if the line looks wrong.

- [ ] **Step 4: Run to verify pass**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖"`
Expected: PASS. Confirm in the screenshot: the open-project view shows the slim bar, Setup opens, and "Switch Project" shows the full hero again.

- [ ] **Step 5: Commit**

```bash
git add -A src test
git commit -m "feat: slim header while a project is open, last save in the project strip

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Suggested save message

**Files:**
- Create: `src/gui/renderer/message-suggestion.js`, `test/message-suggestion.test.js`
- Modify: `test/round1-cleanup.test.js`, `src/gui/renderer/{index.html,app.js}`

**Interfaces:**
- Produces: `suggestMessage(files) -> string` where `files` is `Array<{ path: string, status: string }>` (status values from `src/datalad/status.js`: `untracked|added|modified|deleted|renamed|conflict|changed`); returns `''` for no files. Produces DOM `#use-suggestion` button.

- [ ] **Step 1: Write the failing tests**

Create `test/message-suggestion.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { suggestMessage } from '../src/gui/renderer/message-suggestion.js'

const f = (path, status = 'modified') => ({ path, status })

test('no files: no suggestion', () => {
  assert.equal(suggestMessage([]), '')
})

test('one file: verb by status and the file name only', () => {
  assert.equal(suggestMessage([f('participants.tsv')]), 'Update participants.tsv')
  assert.equal(suggestMessage([f('notes.md', 'untracked')]), 'Add notes.md')
  assert.equal(suggestMessage([f('sub-01/anat/old.csv', 'deleted')]), 'Delete old.csv')
  assert.equal(suggestMessage([f('a/b/new name.txt', 'renamed')]), 'Rename new name.txt')
})

test('two or three files: first name and a count of the rest', () => {
  assert.equal(suggestMessage([f('participants.tsv'), f('a.txt'), f('b.txt')]), 'Update participants.tsv and 2 more')
  assert.equal(suggestMessage([f('a.txt'), f('b.txt')]), 'Update a.txt and 1 more')
})

test('four or more files: a plain count', () => {
  assert.equal(suggestMessage([1, 2, 3, 4, 5].map((n) => f(`f${n}.txt`))), 'Update 5 files')
})

test('the verb is shared only when every file has the same kind of change', () => {
  assert.equal(suggestMessage([f('a.txt', 'untracked'), f('b.txt', 'added')]), 'Add a.txt and 1 more')
  assert.equal(suggestMessage([f('a.txt', 'untracked'), f('b.txt', 'modified')]), 'Update a.txt and 1 more')
  assert.equal(suggestMessage([1, 2, 3, 4].map((n) => f(`n${n}.txt`, 'untracked'))), 'Add 4 files')
})

test('unicode names and backslash paths use the last segment', () => {
  assert.equal(suggestMessage([f('Daten\\Größe ä.csv')]), 'Update Größe ä.csv')
})
```

Append to `test/round1-cleanup.test.js`:

```js
test('the message suggestion is wired as a placeholder and a Use suggestion button', () => {
  assert.match(html, /id="use-suggestion"[^>]*hidden/)
  assert.match(app, /import \{ suggestMessage \} from '\.\/message-suggestion\.js'/)
  assert.match(app, /elements\.message\.placeholder = suggestion \|\| 'Describe what you changed'/)
  assert.match(app, /elements\.useSuggestionButton\.addEventListener\('click'/)
  // The suggestion is only ever typed into the field by the user's click, never sent implicitly.
  assert.doesNotMatch(app, /message: suggest|\|\| suggestion\b.*message/)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/message-suggestion.test.js test/round1-cleanup.test.js`
Expected: FAIL (module not found; markup missing).

- [ ] **Step 3: Implement**

Create `src/gui/renderer/message-suggestion.js`:

```js
// A suggested save message for the files about to be saved ("Update a.tsv and 2 more").
// Pure; the UI shows it as a placeholder and lets the user accept it with one click.

const VERBS = { untracked: 'Add', added: 'Add', deleted: 'Delete', renamed: 'Rename' }
const verbFor = (status) => VERBS[status] ?? 'Update'
const baseName = (path) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

/** @param {Array<{ path: string, status: string }>} files */
export function suggestMessage(files) {
  if (files.length === 0) {
    return ''
  }
  const verbs = new Set(files.map((file) => verbFor(file.status)))
  const verb = verbs.size === 1 ? [...verbs][0] : 'Update'
  if (files.length === 1) {
    return `${verb} ${baseName(files[0].path)}`
  }
  if (files.length <= 3) {
    return `${verb} ${baseName(files[0].path)} and ${files.length - 1} more`
  }
  return `${verb} ${files.length} files`
}
```

`index.html`: next to `#save-guidance` add

```html
<button id="use-suggestion" class="button button-ghost button-inline" type="button" hidden>Use suggestion</button>
```

`app.js`: import `suggestMessage`; add `useSuggestionButton: document.getElementById('use-suggestion')` to `elements`; in `updateSaveButtonState` (after computing `gating`) add:

```js
  const selectedFiles = (snapshot?.files ?? []).filter((entry) => state.selectedChangedPaths.has(entry.path))
  const suggestion = suggestMessage(selectedFiles)
  elements.message.placeholder = suggestion || 'Describe what you changed'
  elements.useSuggestionButton.hidden = !suggestion || Boolean(elements.message.value.trim())
  elements.useSuggestionButton.dataset.suggestion = suggestion
```

and, near the `elements.message` listeners:

```js
elements.useSuggestionButton.addEventListener('click', () => {
  elements.message.value = elements.useSuggestionButton.dataset.suggestion ?? ''
  elements.message.dispatchEvent(new Event('input'))
  elements.message.focus()
})
```
(Verify `snapshot.files` entries expose `path` and `status`: `grep -n "status" src/gui/renderer/app.js | grep -i renderChangedFileItem`. If the field is not called `status`, change the mapping in the call, e.g. `.map((entry) => ({ path: entry.path, status: entry.<field> }))`, and note it in the ledger.)

- [ ] **Step 4: Run to verify pass**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖"`
Expected: PASS. In the app: with two changed files the placeholder shows the suggestion and **Use suggestion** fills the field; with an empty field and no click, Save still falls back to the auto message (`save <date> <time>`).

- [ ] **Step 5: Commit**

```bash
git add -A src test
git commit -m "feat: suggest a save message from the selected files

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: "Continue with <project>" on the start screen

**Files:**
- Modify: `test/round1-cleanup.test.js`, `src/gui/renderer/{index.html,app.js,styles.css}`

**Interfaces:**
- Produces: `openRecentProject(projectPath)` (extracted from the recent-slot click handler, `app.js` ~line 313) and DOM `#continue-project` with child `#continue-project-name`.

- [ ] **Step 1: Write the failing tests**

Append to `test/round1-cleanup.test.js`:

```js
test('the start screen offers one big Continue button for the most recent project', () => {
  const group = html.slice(html.indexOf('id="onboarding-group"'), html.indexOf('id="open-project-panel"'))
  assert.match(group, /id="continue-project"[^>]*hidden/)
  assert.ok(group.indexOf('id="continue-project"') < group.indexOf('class="onboarding-picker'), 'Continue sits above Open/Create')
  assert.match(group, /id="continue-project-name"/)
  assert.match(app, /async function openRecentProject\(projectPath\)/)
  assert.match(app, /continueProjectButton\.addEventListener\('click', \(\) => openRecentProject\(state\.recentProjects\[0\]\)\)/)
  const render = app.slice(app.indexOf('function renderRecentProjects'))
  assert.match(render.slice(0, render.indexOf('\n}\n')), /continueProjectButton\.hidden/)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/round1-cleanup.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

`index.html`: as the first child of `<section id="onboarding-group" …>` add

```html
<button id="continue-project" class="button button-primary continue-button" type="button" hidden>
  Continue with <strong id="continue-project-name"></strong>
</button>
```

`app.js`:
- Add `continueProjectButton` and `continueProjectName` to `elements`.
- Extract the body of the `elements.recentProjectsOutput` click handler (after reading `projectPath`) into `async function openRecentProject(projectPath)` containing exactly the existing statements (`setLastActionState('Switching to recent project...', 'idle')`, setting `projectPath`/`commandProjectPath`, `await detectProjectType(projectPath)`, keeping the comment about authorization order), and make the handler call it.
- After the handler: `elements.continueProjectButton.addEventListener('click', () => openRecentProject(state.recentProjects[0]))`.
- In `renderRecentProjects`, set visibility in both branches: when `state.recentProjects.length === 0` set `elements.continueProjectButton.hidden = true` before the early return; otherwise set `elements.continueProjectButton.hidden = false` and `elements.continueProjectName.textContent = projectTitleForPath(state.recentProjects[0]) || projectNameFromPath(state.recentProjects[0])` (before building the slots).
`styles.css`: append

```css
.continue-button {
  width: 100%;
  padding: 18px 20px;
  font-size: 1.15rem;
  margin-bottom: 12px;
}
```
The button lives in `#onboarding-group`, which `setOnboardingExpanded(false)` already collapses while a project is open, so it needs no extra hiding (confirm in the app).

- [ ] **Step 4: Run to verify pass, then check the missing-folder case**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖"`
Expected: PASS. Then with a scratch script (see Task 4 for the driver pattern) seed `state.recentProjects` with a path that does not exist (set localStorage recent projects, reload), click `#continue-project` and confirm the existing error shows in the last-action state and the app stays usable; record the observed message in the ledger. If the existing flow shows nothing useful, add the smallest message in `openRecentProject`'s caller path and write a `Ruling:`.

- [ ] **Step 5: Commit**

```bash
git add -A src test
git commit -m "feat: Continue with the most recent project from the start screen

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs and merge readiness

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `docs/roadmap.md`, `docs/product/researcher-workflow.md`, `docs/tutorials/*.md`, `test/docs-link.test.js` (only if it asserts removed text)

- [ ] **Step 1: Write the failing test**

Append to `test/round1-cleanup.test.js`:

```js
import { readdirSync } from 'node:fs'

test('user docs no longer mention checkpoints, the console or Power user mode', () => {
  const files = [
    'README.md',
    'docs/product/researcher-workflow.md',
    ...readdirSync(new URL('../docs/tutorials/', import.meta.url))
      .filter((name) => name.endsWith('.md'))
      .map((name) => `docs/tutorials/${name}`)
  ]
  for (const file of files) {
    assert.doesNotMatch(read(file), /checkpoint|Power user mode|power-user mode|command console/i, file)
  }
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/round1-cleanup.test.js`
Expected: FAIL (names the files that still say "checkpoint").

- [ ] **Step 3: Update the docs**

For each file the test names: replace "checkpoint" with "save" (verb "Save a checkpoint" → "Save", noun "a checkpoint" → "a save"), keep "version" for marked states, delete sentences about the console and Power user mode (`docs/product/researcher-workflow.md` item 8 and the console paragraph; replace with: "Power users have the terminal; recorded `datalad run` commands from the terminal show up in Tools → History."). In `docs/roadmap.md` lines ~85-88 change the console paragraph to say it was removed in favour of the terminal and a planned `datalad run` popup. Add a `CHANGELOG.md` entry under the top "Unreleased" heading (create it if missing): "Removed the command console and Power user mode; removed manual file paths from Save; one 'save' vocabulary; slim header; suggested save message; Continue button on the start screen; Home view with Tools." Screenshots in `docs/_static/screenshots` still show the old UI: list them in the PR description.

- [ ] **Step 4: Run to verify pass**

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖"` and the full e2e: `env -u ELECTRON_RUN_AS_NODE npm run test:e2e`
Expected: PASS (no failures; the cancel e2e file no longer exists).

- [ ] **Step 5: Commit, then audit and PR**

```bash
git add -A README.md CHANGELOG.md docs test
git commit -m "docs: save vocabulary, no console, changelog

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Run `ponytail:ponytail-audit` over the branch, handle or decline each finding, then open the PR with base `feat/home-and-tools` (retarget to `main` once #25 merges).
