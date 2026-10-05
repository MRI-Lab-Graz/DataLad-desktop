# Science Workflow Additions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the six features that a researcher hits in the normal collect → analyse → save → share → publish cycle and that the app does not cover yet: Free Up Space (drop), Versions (tags), Check Data Integrity (fsck), recorded-run provenance in Time Machine, file-count progress for Get/Publish, and one Add-a-Remote flow.

**Architecture:** Every feature follows the existing path: a curated command in `src/datalad/adapter.js` (+ its schema in `schema.js`, + researcher copy in `errors.js`), reached through the single `adapter:runCommand` IPC handler in `src/gui/main.js`, invoked from a button in `index.html` / `app.js` via `runWorkflowCommand`. Decision logic that the renderer needs lives in small pure modules under `src/gui/renderer/` so it is unit-testable without Electron. The six parts are independent; ship them in any order, one PR each.

**Tech Stack:** Electron, vanilla JS (ESM), Node built-in test runner (`npm test`), real DataLad 1.6 / git-annex 10 for the one e2e spec.

**Spec:** No separate spec doc. Design source is the 2026-10-05 Gooey comparison conversation; the decisions it fixed are copied into Global Constraints below. Behaviour facts below were verified against DataLad 1.6.3 / git-annex 10.20260901 on 2026-10-05:
- `datalad drop` (with or without paths) refuses when no other verified copy exists: stdout `drop(error): big.bin (file) [unsafe; Could not verify the existence of the 1 necessary copy.; ...]`, exit ≠ 0. With no paths it drops all content of the dataset.
- `datalad get` / `datalad push` print **no** progress when stdout is not a TTY (`DATALAD_UI_PROGRESSBAR=log` changes nothing). They do print one result line per file on stdout: `get(ok): big.bin (file) [from origin...]`.
- `datalad push` does **not** push tags. `git push <remote> --tags` does.
- A bare folder remote only receives annexed data on the first `datalad push` if it was `git annex init`-ed beforehand (otherwise the first push sends git history only: `copy (notneeded: 1)`).
- `git annex fsck --json` prints one JSON object per file; a damaged file has `"success":false`; the command then exits ≠ 0 and moves the bad copy aside (it becomes "missing", Get Data restores it).
- A `datalad run` commit message looks like:
  ```
  [DATALAD RUNCMD] count bytes

  === Do not change lines below ===
  {
   "chain": [],
   "cmd": "wc -c big.bin > size.txt",
   "dsid": "78724cf9-1a42-46be-946f-db4fd4fcf173",
   "exit": 0,
   "extra_inputs": [],
   "inputs": [],
   "outputs": [],
   "pwd": "."
  }
  ^^^ Do not change lines above ^^^
  ```
  With `--sidecar yes` the block holds only a quoted record id: `"096af45aed7a10156f034044fb8f7849"`.

## Global Constraints

- Scope is deliberate: a power user has the terminal. Do **not** add generic command forms, metadata editing, credential management, containers, sibling-creation for specific hosts, or `datalad rerun` (rerun executes a command taken from repository history — arbitrary code from a possibly cloned dataset; showing it is enough).
- No new npm dependencies.
- TDD for every function: failing test first, `npm test` (Node built-in runner) must pass before each commit.
- Every IPC handler that takes a renderer-supplied path calls `requireAuthorizedRoot` (or, for a new folder, the empty-or-confirmed rule) before touching the filesystem.
- Renderer-supplied names that reach a command line (`tagName`, `remoteName`, `url`) are rejected if they start with `-`; names are validated against `SAFE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/` (no `..`, no trailing `.lock`).
- Anything that pushes to a remote re-checks trust right before it runs, exactly like `push` does today.
- UI copy is plain language for researchers ("version", "copy", "free up space"), not git vocabulary, matching existing strings.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Tag or remote name typed with spaces, slashes, a leading `-`, `..`, or non-ASCII** — rejected with a clear message before any git process starts (Task 3, Task 14 tests).
2. **"Add folder remote" pointed at a non-empty folder (e.g. the user's Documents)** — refused, nothing written into it (Task 16 test).
3. **A run-record commit whose message was hand-edited into invalid JSON, or uses Windows `\r\n`** — Time Machine shows the plain message, never throws (Task 9 test).
4. **A per-file result line split across two stdout chunks** — counted exactly once (Task 11 test).
5. **Remote name that already exists (e.g. `origin`)** — friendly "pick another name" error, not the raw DataLad output (Task 14 test).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/datalad/schema.js` | modify | request schemas + leading-dash fields for `drop`, `createTag`, `pushTags`, `verify`, `addRemote`; `push` gains optional `remoteName` |
| `src/datalad/adapter.js` | modify | command lines for the new curated commands; `listRecentCommits` returns tags; `prepareFolderRemote`, `trackRemote` |
| `src/datalad/errors.js` | modify | `DROP_UNSAFE`, `TAG_EXISTS`, `REMOTE_EXISTS` copy |
| `src/datalad/result-counter.js` | create | counts per-file result lines across output chunks |
| `src/datalad/process-runner.js` | modify | `onData(chunk)` option |
| `src/gui/main.js` | modify | progress events; trust re-check for `pushTags`; `prepareFolderRemote` / `trackRemote` handlers |
| `src/gui/preload.js` | modify | expose `onCommandProgress`, `prepareFolderRemote`, `trackRemote` |
| `src/gui/renderer/button-gating.js` | modify | `computeAnnexToolGating`; `addRemote` visibility in `computeRemoteGating` |
| `src/gui/renderer/identity-guard.js` | modify | `createTag` needs a git identity |
| `src/gui/renderer/integrity.js` | create | `summarizeFsck(stdout)` |
| `src/gui/renderer/run-record.js` | create | `parseRunRecord(message)`, `isRunCommit(subject)` |
| `src/gui/renderer/run-activity.js` | modify | `formatProgress(done, total)`; progress span in running rows |
| `src/gui/renderer/index.html`, `app.js`, `styles.css` | modify | buttons, fields, rendering |
| `e2e/science-workflow.e2e.mjs` | create | one real-annex round trip over all six features |

---

## Part A — Free Up Space (drop)

### Task 1: `drop` command and its refusal copy

**Files:**
- Modify: `src/datalad/schema.js`, `src/datalad/adapter.js:12-27` (CURATED_COMMANDS), `src/datalad/adapter.js:1205-1215` (#buildCommand, after `unlock`), `src/datalad/errors.js:236-246` (after the `unlock` mapping)
- Test: `test/adapter.test.js`, `test/errors.test.js`

**Interfaces:**
- Produces: curated command `'drop'` with request `{ projectPath: string, paths?: string[] }`; error code `'DROP_UNSAFE'`.

- [ ] **Step 1: Write the failing tests**

Append to `test/adapter.test.js`:

```js
test('runCommand routes drop for selected paths through datalad drop', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['-C', '/tmp/project', 'drop', '--', 'sub-01/anat.nii.gz'], { stdout: 'drop(ok): sub-01/anat.nii.gz (file)\n' })

  const result = await new DataLadAdapter({ runner }).runCommand('drop', {
    projectPath: '/tmp/project',
    paths: ['sub-01/anat.nii.gz']
  })

  assert.equal(result.ok, true)
  assert.deepEqual(runner.calls[0].args, ['-C', '/tmp/project', 'drop', '--', 'sub-01/anat.nii.gz'])
})

test('runCommand drops the whole dataset content when no paths are given', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['-C', '/tmp/project', 'drop'], { stdout: 'drop(ok): . (directory)\n' })

  const result = await new DataLadAdapter({ runner }).runCommand('drop', { projectPath: '/tmp/project' })

  assert.equal(result.ok, true)
  assert.deepEqual(runner.calls[0].args, ['-C', '/tmp/project', 'drop'])
})
```

Append to `test/errors.test.js`:

```js
test('mapCommandError explains a drop refused because no other copy is verified', () => {
  const result = mapCommandError('drop', {
    stdout: 'drop(error): big.bin (file) [unsafe; Could not verify the existence of the 1 necessary copy.; ' +
      '(Use --reckless availability to override this check, or adjust numcopies.)]\n',
    stderr: ''
  })
  assert.equal(result.code, 'DROP_UNSAFE')
  assert.match(result.message, /nothing was removed/i)
  assert.match(result.technicalDetails, /necessary copy/)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/adapter.test.js test/errors.test.js`
Expected: FAIL — `Unsupported command: drop` and `'UNKNOWN' !== 'DROP_UNSAFE'`.

- [ ] **Step 3: Implement**

`src/datalad/schema.js` — add to `COMMAND_SCHEMAS`:

```js
  drop: {
    required: ['projectPath'],
    optional: ['paths']
  },
```

`src/datalad/adapter.js` — add `'drop'` to `CURATED_COMMANDS`, and in `#buildCommand` after the `unlock` case:

```js
      case 'drop': {
        // datalad refuses to drop the last verified copy by itself (no --reckless here, ever).
        const projectPath = request.projectPath
        const paths = request.paths ?? []
        return {
          command: 'datalad',
          args: paths.length > 0 ? ['-C', projectPath, 'drop', '--', ...paths] : ['-C', projectPath, 'drop'],
          options: { cwd: projectPath }
        }
      }
```

`src/datalad/errors.js` — after the `unlock` / `CONTENT_NOT_LOCAL` block:

```js
  // datalad reports the refusal as a drop(error) result line on stdout.
  if (commandName === 'drop' && hasPattern(`${stdout}\n${stderr}`, /unsafe|could not verify|necessary cop/)) {
    return {
      code: 'DROP_UNSAFE',
      title: 'Not removed: no other copy is confirmed',
      message:
        'DataLad could not confirm that another copy of this data exists (for example on your remote or backup), so nothing was removed. Publish first, then try again.',
      technicalDetails: details || stdout.trim()
    }
  }
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/datalad/schema.js src/datalad/adapter.js src/datalad/errors.js test/adapter.test.js test/errors.test.js
git commit -m "feat: drop command that never removes the last copy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Free Up Space button

**Files:**
- Modify: `src/gui/renderer/button-gating.js`, `src/gui/renderer/index.html:427-439`, `src/gui/renderer/app.js` (elements map ~line 163, handler after `unlockFilesButton` ~line 915, gating ~line 2975, `actionLabel` ~line 2810)
- Test: `test/button-gating.test.js`

**Interfaces:**
- Consumes: curated command `'drop'` (Task 1).
- Produces: `computeAnnexToolGating(classification, readyTitle) → { disabled: boolean, title: string }` (also used by Task 8).

- [ ] **Step 1: Write the failing test**

Append to `test/button-gating.test.js` (and add `computeAnnexToolGating` to its import list):

```js
test('computeAnnexToolGating disables annex-only actions for a plain git project', () => {
  const gating = computeAnnexToolGating('git', 'Ready.')
  assert.equal(gating.disabled, true)
  assert.match(gating.title, /plain Git project/)
})

test('computeAnnexToolGating enables annex-only actions for datasets with the given title', () => {
  for (const classification of ['dataset', 'superdataset']) {
    assert.deepEqual(computeAnnexToolGating(classification, 'Ready.'), { disabled: false, title: 'Ready.' })
  }
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/button-gating.test.js`
Expected: FAIL — `computeAnnexToolGating is not a function` (import error).

- [ ] **Step 3: Implement**

`src/gui/renderer/button-gating.js`, after `computeUnlockGating`:

```js
const NOT_A_DATASET_ANNEX_TITLE =
  'This is a plain Git project, not a DataLad dataset, so it has no separately stored data.'

/**
 * Actions that only make sense on git-annex content (Free Up Space, Check Data Integrity).
 * @param {string|null|undefined} classification
 * @param {string} readyTitle tooltip when the action is available
 * @returns {{ disabled: boolean, title: string }}
 */
export function computeAnnexToolGating(classification, readyTitle) {
  const isDataLadDataset = classification === 'dataset' || classification === 'superdataset'
  return isDataLadDataset ? { disabled: false, title: readyTitle } : { disabled: true, title: NOT_A_DATASET_ANNEX_TITLE }
}
```

`src/gui/renderer/index.html` — inside the first `sibling-action-group` after `#unlock-files`'s group, add a sibling group:

```html
            <button id="drop-data" class="button button-ghost" type="button">Free Up Space</button>
```

`src/gui/renderer/app.js`:
- import `computeAnnexToolGating` from `./button-gating.js`.
- elements map: `dropDataButton: document.getElementById('drop-data'),`
- in the function that applies `computeUnlockGating` (~line 2975), add:

```js
  const dropGating = computeAnnexToolGating(
    state.currentProjectClassification,
    'Remove the local copy of downloaded data to free disk space. Only works when another copy (remote or backup) is confirmed; Get Data brings it back.'
  )
  elements.dropDataButton.disabled = dropGating.disabled
  elements.dropDataButton.title = dropGating.title
```

- handler, after the Unlock handler:

```js
elements.dropDataButton.addEventListener('click', async () => {
  const projectPath = readProjectPath()
  if (!projectPath) {
    return
  }

  const paths = parsePaths(elements.paths.value)
  const scope = paths.length > 0 ? `${paths.length} selected item(s)` : 'all downloaded data in this folder'
  const confirmed = window.confirm(
    `Free up space by removing the local copy of ${scope}?\n\n` +
      '- Only removed when another copy (your remote or backup) is confirmed. Otherwise nothing happens.\n' +
      '- Files stay listed; use Get Data to download them again.\n\n' +
      'Continue?'
  )
  if (!confirmed) {
    return
  }

  await runWorkflowCommand('drop', { projectPath, paths }, elements.dropDataButton)
  await refreshFileBrowser(projectPath)
})
```

- `actionLabel`: add `if (commandName === 'drop') { return 'Free Up Space' }` before the final `return 'Action'`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Manual check**

Run: `npm start`, open a DataLad dataset that has a remote with the data, click **Free Up Space** → confirm → the result panel shows success and the file badge turns to "not downloaded". On a dataset with no other copy the panel shows "Not removed: no other copy is confirmed".

- [ ] **Step 6: Commit**

```bash
git add src/gui/renderer/button-gating.js src/gui/renderer/index.html src/gui/renderer/app.js test/button-gating.test.js
git commit -m "feat: Free Up Space button next to Get Data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Part B — Versions (tags)

### Task 3: `createTag` command

**Files:**
- Modify: `src/datalad/schema.js`, `src/datalad/adapter.js` (constants near line 28, CURATED_COMMANDS, #buildCommand), `src/datalad/errors.js:63-70`, `src/gui/renderer/identity-guard.js:5`
- Test: `test/adapter.test.js`, `test/errors.test.js`, `test/identity-guard.test.js`

**Interfaces:**
- Produces: curated `'createTag'` with request `{ projectPath, tagName, message, commitHash }`; exported `SAFE_NAME_PATTERN` from `adapter.js` (reused by Task 14 and Task 15); error code `'TAG_EXISTS'`.

- [ ] **Step 1: Write the failing tests**

`test/adapter.test.js`:

```js
test('runCommand creates an annotated version tag at a save point', async () => {
  const runner = new FakeRunner()
  const args = ['-C', '/tmp/project', 'tag', '-a', '--message=paper submission', 'v1.0', 'abc1234']
  runner.set('git', args, {})

  const result = await new DataLadAdapter({ runner }).runCommand('createTag', {
    projectPath: '/tmp/project',
    tagName: 'v1.0',
    message: 'paper submission',
    commitHash: 'abc1234'
  })

  assert.equal(result.ok, true)
  assert.deepEqual(runner.calls[0].args, args)
})

test('runCommand rejects version names git or a shell could misread', async () => {
  const adapter = new DataLadAdapter({ runner: new FakeRunner() })
  for (const tagName of ['-f', 'v 1', 'a/b', 'v1..2', 'v1.lock', 'versión', '.hidden']) {
    await assert.rejects(
      adapter.runCommand('createTag', { projectPath: '/tmp/p', tagName, message: 'm', commitHash: 'abc1234' }),
      /version name|cannot start with -/i,
      tagName
    )
  }
})
```

`test/errors.test.js`:

```js
test('mapCommandError maps an existing tag name', () => {
  const result = mapCommandError('createTag', { stderr: "fatal: tag 'v1.0' already exists" })
  assert.equal(result.code, 'TAG_EXISTS')
})
```

`test/identity-guard.test.js`:

```js
test('creating a version needs a git identity (annotated tags record the tagger)', () => {
  assert.equal(shouldBlockForIdentity('createTag', { available: true, complete: false }), true)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/adapter.test.js test/errors.test.js test/identity-guard.test.js`
Expected: FAIL — `Unsupported command: createTag`, `UNKNOWN`, `false !== true`.

- [ ] **Step 3: Implement**

`schema.js` — schema and leading-dash entry:

```js
  createTag: {
    required: ['projectPath', 'tagName', 'message', 'commitHash'],
    optional: []
  },
```
```js
  createTag: ['tagName'],
```

`adapter.js` — near `COMMIT_HASH_PATTERN`:

```js
// Version (tag) and remote names typed by the user: plain ASCII, no ref syntax git would interpret.
export const SAFE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
function isSafeName(name) {
  return SAFE_NAME_PATTERN.test(name) && !name.includes('..') && !name.endsWith('.lock')
}
```

add `'createTag'` to `CURATED_COMMANDS`, and the case:

```js
      case 'createTag': {
        const { projectPath, tagName, message, commitHash } = request
        if (!isSafeName(tagName)) {
          throw new Error(`Invalid version name: ${tagName}. Use letters, digits, dot, dash or underscore.`)
        }
        if (!COMMIT_HASH_PATTERN.test(commitHash)) {
          throw new Error(`Invalid commit hash format: ${commitHash}`)
        }
        return {
          command: 'git',
          args: ['-C', projectPath, 'tag', '-a', `--message=${message}`, tagName, commitHash],
          options: { cwd: projectPath }
        }
      }
```

`errors.js` — next to `BRANCH_EXISTS`:

```js
  if (commandName === 'createTag' && hasPattern(stderr, /already exists/)) {
    return {
      code: 'TAG_EXISTS',
      title: 'Version name already used',
      message: 'A version with this name already exists in this project. Pick a different name.',
      technicalDetails: details
    }
  }
```

`identity-guard.js`:

```js
// Commands that create a git commit or an annotated tag (re-verified against adapter.js).
const COMMIT_COMMANDS = new Set(['save', 'createProject', 'createSubdataset', 'update', 'createTag'])
```

- [ ] **Step 4: Run tests** — `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/datalad/schema.js src/datalad/adapter.js src/datalad/errors.js src/gui/renderer/identity-guard.js test/adapter.test.js test/errors.test.js test/identity-guard.test.js
git commit -m "feat: createTag command for marking a save point as a version

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: history shows versions

**Files:**
- Modify: `src/datalad/adapter.js:640-695` (`listRecentCommits`)
- Test: `test/adapter.test.js:919-970` (update the two existing mocks' format string, add one test)

**Interfaces:**
- Produces: each commit from `listRecentCommits` gains `tags: string[]`.

- [ ] **Step 1: Write the failing test** (and change `'--format=%ct%x00%h%x00%an%x00%s'` to `'--format=%ct%x00%h%x00%an%x00%s%x00%D'` in the two existing `listRecentCommits` tests' `runner.set` calls)

```js
test('listRecentCommits returns the version tags on each commit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-tags-'))
  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { stdout: 'true\n' })
  runner.set('git', ['-C', root, 'log', '-n', '20', '--format=%ct%x00%h%x00%an%x00%s%x00%D'], {
    stdout:
      '1700000100\u0000bbb2222\u0000Ana\u0000final\u0000HEAD -> main, tag: v1.0, tag: submitted, origin/main\n' +
      '1700000000\u0000aaa1111\u0000Ana\u0000first\u0000\n'
  })

  const history = await new DataLadAdapter({ runner }).listRecentCommits(root)

  assert.deepEqual(history.commits.map((c) => c.tags), [['v1.0', 'submitted'], []])
})
```

- [ ] **Step 2: Run** — `node --test test/adapter.test.js` → FAIL (`undefined` tags / unmocked format).

- [ ] **Step 3: Implement** in `listRecentCommits`: change the format to `'--format=%ct%x00%h%x00%an%x00%s%x00%D'` and the parse to:

```js
      const [timestampRaw, commitHash, author, subject, decorations] = line.split('\u0000')
```
```js
      commits.push({
        timestamp,
        commitHash: (commitHash ?? '').trim(),
        author: (author ?? '').trim(),
        subject: (subject ?? '').trim(),
        tags: (decorations ?? '')
          .split(', ')
          .filter((d) => d.startsWith('tag: '))
          .map((d) => d.slice('tag: '.length).trim())
      })
```

- [ ] **Step 4: Run** — `npm test` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: commit history carries version tags"` (+ trailer).

### Task 5: Publish sends versions too

**Files:**
- Modify: `src/datalad/schema.js`, `src/datalad/adapter.js`, `src/gui/main.js:269-278` (recheckTrust)
- Test: `test/adapter.test.js`, `test/trust-wiring.test.js`

**Interfaces:**
- Produces: curated `'pushTags'` with request `{ projectPath, remoteName }`.

- [ ] **Step 1: Write the failing tests**

`test/adapter.test.js`:

```js
test('runCommand pushes version tags to the named remote (datalad push does not)', async () => {
  const runner = new FakeRunner()
  runner.set('git', ['-C', '/tmp/project', 'push', '--tags', 'origin'], {})

  const result = await new DataLadAdapter({ runner }).runCommand('pushTags', { projectPath: '/tmp/project', remoteName: 'origin' })

  assert.equal(result.ok, true)
})

test('pushTags refuses a remote name that looks like a flag', async () => {
  await assert.rejects(
    new DataLadAdapter({ runner: new FakeRunner() }).runCommand('pushTags', { projectPath: '/tmp/p', remoteName: '--mirror' }),
    /cannot start with -/
  )
})
```

`test/trust-wiring.test.js`:

```js
test('sending versions to a remote re-checks trust exactly like Publish', () => {
  const body = block("handle('adapter:runCommand'")
  assert.match(body, /const PUSHES = new Set\(\['push', 'pushTags'\]\)|PUSHES\.has\(payload\.commandName\)/)
  assert.doesNotMatch(body, /payload\.commandName === 'push'/)
})
```

- [ ] **Step 2: Run** — `node --test test/adapter.test.js test/trust-wiring.test.js` → FAIL.

- [ ] **Step 3: Implement**

`schema.js`: `pushTags: { required: ['projectPath', 'remoteName'], optional: [] },` and leading-dash `pushTags: ['remoteName'],`.

`adapter.js`: add `'pushTags'` to `CURATED_COMMANDS`, and:

```js
      case 'pushTags': {
        return {
          command: 'git',
          args: ['-C', request.projectPath, 'push', '--tags', request.remoteName],
          options: { cwd: request.projectPath }
        }
      }
```

`main.js` — above the `adapter:runCommand` handler:

```js
// Everything that writes to a remote: a local-path remote runs its own hooks, so trust is re-checked first.
const PUSHES = new Set(['push', 'pushTags'])
```

and inside `recheckTrust` replace both `payload.commandName === 'push'` with `PUSHES.has(payload.commandName)`.

- [ ] **Step 4: Run** — `npm test` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: pushTags command, trust-checked like Publish"` (+ trailer).

### Task 6: Mark-as-version UI

**Files:**
- Modify: `src/gui/renderer/index.html:616-629` (tm restore actions), `src/gui/renderer/app.js` (elements, Time Machine handlers ~1091, `renderTimeMachineHistory` ~2139, Publish handler ~926, `actionLabel`), `src/gui/renderer/styles.css`

**Interfaces:**
- Consumes: `'createTag'` (Task 3), `commit.tags` (Task 4), `'pushTags'` (Task 5).

- [ ] **Step 1: HTML** — inside `.tm-restore-actions`, after the branch field's hint:

```html
              <label class="field">
                <span>Mark As Version</span>
                <div class="field-row">
                  <input id="tm-version-name" type="text" placeholder="v1.0-submission" />
                  <button id="tm-mark-version" class="button button-ghost button-inline" type="button">Mark</button>
                </div>
              </label>
              <p class="hint-inline">
                Gives this save point a permanent name you can cite in a paper. Publish sends it to your remote.
              </p>
```

- [ ] **Step 2: app.js** — elements `timeMachineVersionName: document.getElementById('tm-version-name')`, `timeMachineMarkVersionButton: document.getElementById('tm-mark-version')`; handler:

```js
elements.timeMachineMarkVersionButton.addEventListener('click', async () => {
  const projectPath = readProjectPath()
  const commitHash = state.timeMachineSelectedHash
  const tagName = elements.timeMachineVersionName.value.trim()
  if (!projectPath || !commitHash) {
    return
  }
  if (!tagName) {
    elements.timeMachineActionOutput.textContent = 'Enter a version name first.'
    elements.timeMachineActionOutput.hidden = false
    return
  }

  const result = await runWorkflowCommand(
    'createTag',
    { projectPath, tagName, message: `Version ${tagName}`, commitHash },
    elements.timeMachineMarkVersionButton
  )
  if (result?.ok) {
    elements.timeMachineActionOutput.innerHTML =
      `<p>Marked save <code>${escapeHtml(commitHash)}</code> as version <strong>${escapeHtml(tagName)}</strong>. ` +
      'Publish to share it.</p>'
    elements.timeMachineVersionName.value = ''
    await refreshTimeMachineHistory(projectPath)
  } else if (result) {
    elements.timeMachineActionOutput.textContent = result.userError?.message ?? 'The version could not be created.'
  }
  elements.timeMachineActionOutput.hidden = false
})
```

`runWorkflowCommand` throws nothing for the adapter's validation errors: they arrive in its `catch` and land in `#command-output`. That is acceptable (same as invalid branch names today).

- [ ] **Step 3: history chip** — in `renderTimeMachineHistory`, after the `history-subject` div:

```js
        (entry.tags?.length
          ? `<div class="history-tags">${entry.tags.map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}</div>`
          : '') +
```

`styles.css`:

```css
.history-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.tag-chip { font-size: 0.75rem; padding: 1px 8px; border-radius: 999px; background: var(--bg-accent); border: 1px solid var(--teal); }
```


- [ ] **Step 4: Publish also sends versions** — replace the Publish handler body after `readProjectPath`:

```js
  const result = await runWorkflowCommand('push', { projectPath }, elements.publishProjectButton)
  const remoteName = state.projectHealthSnapshot?.upstream?.split('/')[0]
  if (result?.ok && remoteName) {
    // datalad push does not send tags; an up-to-date --tags push is a no-op.
    const tags = await api.runCommand('pushTags', { projectPath, remoteName }, createRunId())
    if (!tags?.ok) {
      setLastActionState('Published, but versions could not be sent. Try Publish again.', 'warning')
    }
  }
```

`actionLabel`: `createTag` → `'Mark As Version'`, `pushTags` → `'Publish Versions'`.

- [ ] **Step 5: Run** `npm test` (PASS), then `npm start`: select a save in Time Machine → Mark `v1.0` → chip appears in the list; Publish on a project with a remote → `git -C <remote> tag` lists `v1.0`.

- [ ] **Step 6: Commit** — `git commit -m "feat: mark a save point as a version; Publish sends versions"` (+ trailer).

---

## Part C — Check Data Integrity

### Task 7: `verify` command and fsck summary

**Files:**
- Modify: `src/datalad/schema.js`, `src/datalad/adapter.js`
- Create: `src/gui/renderer/integrity.js`
- Test: `test/adapter.test.js`, `test/integrity.test.js`

**Interfaces:**
- Produces: curated `'verify'` with request `{ projectPath }`; `summarizeFsck(stdout: string) → { checked: number, damaged: string[] }`.

- [ ] **Step 1: Write the failing tests**

`test/adapter.test.js`:

```js
test('runCommand verifies stored data with a full git-annex checksum pass', async () => {
  const runner = new FakeRunner()
  runner.set('git', ['-C', '/tmp/project', 'annex', 'fsck', '--json'], { stdout: '' })

  const result = await new DataLadAdapter({ runner }).runCommand('verify', { projectPath: '/tmp/project' })

  assert.equal(result.ok, true)
})
```

`test/integrity.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeFsck } from '../src/gui/renderer/integrity.js'

const ok = (file) => JSON.stringify({ command: 'fsck', 'error-messages': [], file, success: true })
const bad = (file) => JSON.stringify({ command: 'fsck', 'error-messages': [], file, success: false })

test('summarizeFsck counts checked files and lists damaged ones', () => {
  const stdout = [ok('a.nii'), bad('sub-01/b.nii'), ok('c.tsv'), ''].join('\n')
  assert.deepEqual(summarizeFsck(stdout), { checked: 3, damaged: ['sub-01/b.nii'] })
})

test('summarizeFsck ignores non-JSON noise and empty output', () => {
  assert.deepEqual(summarizeFsck('warning: something\n' + ok('a') + '\nnot json {'), { checked: 1, damaged: [] })
  assert.deepEqual(summarizeFsck(''), { checked: 0, damaged: [] })
})
```

- [ ] **Step 2: Run** — FAIL (`Unsupported command: verify`, module not found).

- [ ] **Step 3: Implement**

`schema.js`: `verify: { required: ['projectPath'], optional: [] },`

`adapter.js`: `'verify'` in `CURATED_COMMANDS`, and:

```js
      case 'verify': {
        // ponytail: this dataset only, not nested subdatasets; add a per-dataset loop if researchers ask.
        return {
          command: 'git',
          args: ['-C', request.projectPath, 'annex', 'fsck', '--json'],
          options: { cwd: request.projectPath }
        }
      }
```

`src/gui/renderer/integrity.js`:

```js
// Pure summary of `git annex fsck --json` output (one JSON object per checked file).
export function summarizeFsck(stdout) {
  let checked = 0
  const damaged = []
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry?.command !== 'fsck') {
      continue
    }
    checked++
    if (entry.success === false) {
      damaged.push(entry.file)
    }
  }
  return { checked, damaged }
}
```

- [ ] **Step 4: Run** — `npm test` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: verify command and fsck summary"` (+ trailer).

### Task 8: Check Data Integrity button

**Files:**
- Modify: `src/gui/renderer/index.html:481-498` (project health panel), `src/gui/renderer/app.js`

**Interfaces:**
- Consumes: `'verify'`, `summarizeFsck` (Task 7), `computeAnnexToolGating` (Task 2).

- [ ] **Step 1: HTML** — in `#project-health-panel`, after `#project-health-output`:

```html
          <div class="action-strip">
            <button id="verify-data" class="button button-ghost" type="button">Check Data Integrity</button>
          </div>
          <div id="verify-output" class="panel panel-muted panel-compact" hidden></div>
```

- [ ] **Step 2: app.js** — import `summarizeFsck` from `./integrity.js`; elements `verifyDataButton`, `verifyOutput`; gating next to the drop gating from Task 2:

```js
  const verifyGating = computeAnnexToolGating(
    state.currentProjectClassification,
    'Re-check every downloaded file against its recorded checksum. Can take a while on large data.'
  )
  elements.verifyDataButton.disabled = verifyGating.disabled
  elements.verifyDataButton.title = verifyGating.title
```

handler:

```js
elements.verifyDataButton.addEventListener('click', async () => {
  const projectPath = readProjectPath()
  if (!projectPath) {
    return
  }

  const result = await runWorkflowCommand('verify', { projectPath }, elements.verifyDataButton)
  if (!result) {
    return
  }
  // fsck exits non-zero when it finds damage, so read the summary even for a "failed" result.
  const { checked, damaged } = summarizeFsck(result.stdout)
  if (checked === 0 && !result.ok) {
    return // a real failure; runWorkflowCommand already rendered it
  }
  elements.verifyOutput.innerHTML = damaged.length === 0
    ? `<p>All ${checked} downloaded file(s) are intact.</p>`
    : `<p><strong>${damaged.length} of ${checked} file(s) are damaged.</strong> The damaged copies were set aside; ` +
      'use Get Data to fetch a good copy from your remote or backup.</p>' +
      `<ul>${damaged.map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join('')}</ul>`
  elements.verifyOutput.hidden = false
  if (damaged.length > 0) {
    setLastActionState(`${damaged.length} damaged file(s) found.`, 'error')
  } else {
    setLastActionState('All data intact.', 'success')
  }
})
```

`actionLabel`: `verify` → `'Check Data Integrity'`. In the project-switch reset (where `state.timeMachineCommits = []` is reset, ~line 2090) add `elements.verifyOutput.hidden = true`.

- [ ] **Step 3: Run** `npm test` → PASS; `npm start` → on a dataset, Check Data Integrity → "All N downloaded file(s) are intact."

- [ ] **Step 4: Commit** — `git commit -m "feat: Check Data Integrity in Project Health"` (+ trailer).

---

## Part D — Provenance of recorded runs

### Task 9: run-record parser

**Files:**
- Create: `src/gui/renderer/run-record.js`
- Test: `test/run-record.test.js`

**Interfaces:**
- Produces: `parseRunRecord(message: string) → null | { sidecar: true } | { cmd: string, exit: number|null, inputs: string[], outputs: string[], pwd: string }`; `isRunCommit(subject: string) → boolean`.

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { isRunCommit, parseRunRecord } from '../src/gui/renderer/run-record.js'

const REAL = `[DATALAD RUNCMD] count bytes

=== Do not change lines below ===
{
 "chain": [],
 "cmd": "wc -c big.bin > size.txt",
 "dsid": "78724cf9-1a42-46be-946f-db4fd4fcf173",
 "exit": 0,
 "extra_inputs": [],
 "inputs": ["big.bin"],
 "outputs": ["size.txt"],
 "pwd": "."
}
^^^ Do not change lines above ^^^`

test('parseRunRecord reads the command, exit code, inputs and outputs of a datalad run commit', () => {
  assert.deepEqual(parseRunRecord(REAL), {
    cmd: 'wc -c big.bin > size.txt', exit: 0, inputs: ['big.bin'], outputs: ['size.txt'], pwd: '.'
  })
})

test('parseRunRecord copes with Windows line endings', () => {
  assert.equal(parseRunRecord(REAL.replace(/\n/g, '\r\n'))?.cmd, 'wc -c big.bin > size.txt')
})

test('parseRunRecord reports a record kept in a sidecar file', () => {
  const sidecar = '[DATALAD RUNCMD] s\n\n=== Do not change lines below ===\n"096af45aed7a10156f034044fb8f7849"\n^^^ Do not change lines above ^^^'
  assert.deepEqual(parseRunRecord(sidecar), { sidecar: true })
})

test('parseRunRecord joins a command stored as a list', () => {
  assert.equal(parseRunRecord(REAL.replace('"wc -c big.bin > size.txt"', '["python", "a.py"]'))?.cmd, 'python a.py')
})

test('parseRunRecord returns null for ordinary saves and hand-edited records', () => {
  assert.equal(parseRunRecord('ordinary save'), null)
  assert.equal(parseRunRecord(REAL.replace('"exit": 0,', '"exit": 0,,')), null)
  assert.equal(parseRunRecord('[DATALAD RUNCMD] no block'), null)
  assert.equal(parseRunRecord(undefined), null)
})

test('isRunCommit recognises the run subject prefix', () => {
  assert.equal(isRunCommit('[DATALAD RUNCMD] count bytes'), true)
  assert.equal(isRunCommit('fix typo'), false)
})
```

- [ ] **Step 2: Run** — `node --test test/run-record.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement** `src/gui/renderer/run-record.js`:

```js
// Reads the provenance record `datalad run` writes into its commit message. Display only:
// re-running it would execute a command taken from (possibly cloned) history.
const RUN_PREFIX = '[DATALAD RUNCMD]'
const RECORD_BLOCK = /=== Do not change lines below ===\n([\s\S]*?)\n\^\^\^ Do not change lines above \^\^\^/
const list = (value) => (Array.isArray(value) ? value.map(String) : [])

export function isRunCommit(subject) {
  return String(subject ?? '').startsWith(RUN_PREFIX)
}

export function parseRunRecord(message) {
  const text = String(message ?? '').replace(/\r\n/g, '\n')
  const block = isRunCommit(text) && text.match(RECORD_BLOCK)
  if (!block) {
    return null
  }
  let record
  try {
    record = JSON.parse(block[1])
  } catch {
    return null
  }
  if (typeof record === 'string') {
    return { sidecar: true }
  }
  const cmd = Array.isArray(record?.cmd) ? record.cmd.join(' ') : record?.cmd
  if (typeof cmd !== 'string') {
    return null
  }
  return {
    cmd,
    exit: Number.isInteger(record.exit) ? record.exit : null,
    inputs: list(record.inputs),
    outputs: list(record.outputs),
    pwd: typeof record.pwd === 'string' ? record.pwd : '.'
  }
}
```

- [ ] **Step 4: Run** — `npm test` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: parse datalad run provenance records"` (+ trailer).

### Task 10: show provenance in Time Machine

**Files:**
- Modify: `src/gui/renderer/app.js` (`renderTimeMachineHistory` ~2139, `renderTimeMachineDetail` ~2209), `src/gui/renderer/styles.css`

**Interfaces:**
- Consumes: `parseRunRecord`, `isRunCommit` (Task 9).

- [ ] **Step 1: history badge** — import from `./run-record.js`; in `renderTimeMachineHistory`, replace the subject div with:

```js
        `<div class="history-subject">${isRunCommit(subject) ? '<span class="run-chip">recorded run</span> ' : ''}` +
        `${escapeHtml(subject.replace('[DATALAD RUNCMD] ', ''))}</div>` +
```

- [ ] **Step 2: detail block** — in `renderTimeMachineDetail`, before `bodyHtml` is computed:

```js
  const run = parseRunRecord(details.message)
  const runHtml = !run
    ? ''
    : run.sidecar
      ? '<div class="tm-run-record"><h4>Produced by a recorded command</h4><p class="hint-inline">The command is stored in the project\'s .datalad/runinfo folder.</p></div>'
      : '<div class="tm-run-record"><h4>Produced by a recorded command</h4>' +
        `<pre class="panel panel-code">${escapeHtml(run.cmd)}</pre>` +
        `<p class="hint-inline">Ran in <code>${escapeHtml(run.pwd)}</code>` +
        (run.exit === null ? '' : `, exit code ${run.exit}`) + '.</p>' +
        (run.inputs.length ? `<p class="hint-inline">Inputs: ${run.inputs.map((p) => `<code>${escapeHtml(p)}</code>`).join(', ')}</p>` : '') +
        (run.outputs.length ? `<p class="hint-inline">Outputs: ${run.outputs.map((p) => `<code>${escapeHtml(p)}</code>`).join(', ')}</p>` : '') +
        '</div>'
```

change `bodyHtml` so the raw JSON block is not shown twice:

```js
  const bodyHtml =
    !run && bodyText && bodyText !== details.subject
      ? `<p class="tm-detail-body">${escapeHtml(bodyText)}</p>`
      : ''
```

and insert `runHtml +` right after `bodyHtml +` in the final `innerHTML` concatenation.

`styles.css`:

```css
.run-chip { font-size: 0.7rem; padding: 1px 6px; border-radius: 999px; background: var(--bg-accent); border: 1px solid var(--teal); }
.tm-run-record { margin-top: 8px; }
```

- [ ] **Step 3: Run** `npm test` → PASS; `npm start` on a dataset with a `datalad run` commit (`datalad run -m test "echo hi > hi.txt"` in a scratch dataset): Time Machine shows the chip and the command block.

- [ ] **Step 4: Commit** — `git commit -m "feat: Time Machine shows recorded-run provenance"` (+ trailer).

---

## Part E — File-count progress for Get and Publish

DataLad prints no progress bar when not attached to a terminal (verified). It does print one result line per file, so progress is "N of M files". Byte progress inside one big file would mean replacing `datalad get` with `git annex get --json-progress` and losing subdataset handling — out of scope.

### Task 11: result counter

**Files:**
- Create: `src/datalad/result-counter.js`
- Test: `test/result-counter.test.js`

**Interfaces:**
- Produces: `createResultCounter() → { push(chunk: string|Buffer): number }` (running count of per-file `get`/`copy` results).

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createResultCounter } from '../src/datalad/result-counter.js'

test('counts per-file get and copy results, not dataset or summary lines', () => {
  const counter = createResultCounter()
  const n = counter.push(
    'get(ok): a.nii (file) [from origin...]\n' +
      'get(notneeded): b.nii (file) [already present]\n' +
      'install(ok): sub-01 (dataset)\n' +
      'copy(ok): c.nii (file) [to backup...]\n' +
      'action summary:\n  get (ok: 1)\n'
  )
  assert.equal(n, 3)
})

test('a line split across chunks is counted once, after it completes', () => {
  const counter = createResultCounter()
  assert.equal(counter.push('get(ok): a.n'), 0)
  assert.equal(counter.push('ii (file) [from origin...]\r\nget(ok): b'), 1)
  assert.equal(counter.push('.nii (file)\n'), 2)
})
```

- [ ] **Step 2: Run** — FAIL (module not found).

- [ ] **Step 3: Implement** `src/datalad/result-counter.js`:

```js
// Counts DataLad's per-file result lines ("get(ok): a.nii (file) [...]") across output chunks.
const FILE_RESULT = /^(?:get|copy)\((?:ok|notneeded)\): .* \(file\)/

export function createResultCounter() {
  let partial = ''
  let count = 0
  return {
    push(chunk) {
      const lines = (partial + String(chunk)).split(/\r?\n/)
      partial = lines.pop()
      for (const line of lines) {
        if (FILE_RESULT.test(line)) {
          count++
        }
      }
      return count
    }
  }
}
```

- [ ] **Step 4: Run** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: count per-file DataLad results across chunks"` (+ trailer).

### Task 12: runner `onData` and progress events

**Files:**
- Modify: `src/datalad/process-runner.js:101` and the `child.stdout.on('data')` handler (~line 223), `src/gui/main.js:55-72` (`runWithHandle`) and the final `runWithHandle` call in `adapter:runCommand` (~line 319), `src/gui/preload.js`
- Test: `test/process-runner.test.js`, `test/trust-wiring.test.js`

**Interfaces:**
- Consumes: `createResultCounter` (Task 11), `createLatestLineThrottle` (existing, `run-registry.js`).
- Produces: runner option `onData(chunk: string)` (stdout only); IPC event `'command:progress'` `{ runId, done: number }`; preload `onCommandProgress(callback) → unsubscribe`.

- [ ] **Step 1: Write the failing tests**

`test/process-runner.test.js` (follow the existing `onOutput` test at ~line 300 for the import of `ProcessRunner`):

```js
test('ProcessRunner hands every stdout chunk to onData, untouched', async () => {
  const chunks = []
  const runner = new ProcessRunner()
  await runner.run(process.execPath, ['-e', 'process.stdout.write("get(ok): a (file)\\n"); process.stderr.write("noise\\n")'], {
    onData: (chunk) => chunks.push(chunk)
  })
  assert.equal(chunks.join(''), 'get(ok): a (file)\n')
})
```

`test/trust-wiring.test.js`:

```js
test('Get and Publish report file-count progress to the page', () => {
  assert.match(main, /'command:progress'/)
  const body = block("handle('adapter:runCommand'")
  assert.match(body, /progress: payload\.commandName === 'get' \|\| payload\.commandName === 'push'/)
})
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`process-runner.js` — destructure `onData` with the other options, and in the stdout handler:

```js
      child.stdout.on('data', (chunk) => {
        if (accept(chunk)) {
          stdout += String(chunk)
          report(chunk)
          onData?.(String(chunk))
        }
      })
```

`main.js` — import `createResultCounter` from `'../datalad/result-counter.js'`; replace `runWithHandle` with:

```js
async function runWithHandle(event, runId, run, { progress = false } = {}) {
  if (runId === undefined) {
    return run({})
  }

  const signal = runRegistry.register(runId)
  const send = (channel, payload) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(channel, payload)
    }
  }
  const activity = createLatestLineThrottle((line) => send('command:activity', { runId, line }))
  // The throttle only ever sends the newest value, which is what a running count needs.
  const counted = progress ? createLatestLineThrottle((done) => send('command:progress', { runId, done })) : null
  const counter = progress ? createResultCounter() : null
  try {
    return await run({
      signal,
      onOutput: activity.push,
      ...(counted ? { onData: (chunk) => counted.push(counter.push(chunk)) } : {})
    })
  } finally {
    activity.stop()
    counted?.stop()
    runRegistry.finish(runId)
  }
}
```

and at the final call in `adapter:runCommand`:

```js
  const result = await runWithHandle(event, payload.runId, async (runOptions) => {
    await recheckTrust()
    return adapter.runCommand(payload.commandName, request, runOptions)
  }, { progress: payload.commandName === 'get' || payload.commandName === 'push' })
```

`preload.js`:

```js
  onCommandProgress: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('command:progress', listener)
    return () => ipcRenderer.removeListener('command:progress', listener)
  },
```

- [ ] **Step 4: Run** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: file-count progress events for Get and Publish"` (+ trailer).

### Task 13: show progress in the running strip

**Files:**
- Modify: `src/gui/renderer/run-activity.js`, `src/gui/renderer/app.js` (`trackRun` ~1393, `onCommandActivity` ~1405, `runWorkflowCommand` ~1441, Get handler ~873)
- Test: `test/run-activity.test.js`

**Interfaces:**
- Consumes: `api.onCommandProgress` (Task 12).
- Produces: `formatProgress(done: number, total: number|null) → string`; `runWorkflowCommand(..., options)` accepts `options.progressTotal`.

- [ ] **Step 1: Write the failing test** (add `formatProgress` to the file's import)

```js
test('formatProgress shows N of M when the total is known, a running count otherwise', () => {
  assert.equal(formatProgress(12, 340), '12 of 340 files')
  assert.equal(formatProgress(400, 340), '340 of 340 files')
  assert.equal(formatProgress(1, null), '1 file done')
  assert.equal(formatProgress(5, 0), '5 files done')
})

test('renderRunningRows includes the progress text when present', () => {
  const html = renderRunningRows([{ runId: 'r1', label: 'Get Data', line: '', progress: '3 of 9 files' }])
  assert.match(html, /<span class="running-progress">3 of 9 files<\/span>/)
})
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** in `run-activity.js`:

```js
export function formatProgress(done, total) {
  if (total > 0) {
    return `${Math.min(done, total)} of ${total} files`
  }
  return `${done} file${done === 1 ? '' : 's'} done`
}
```

and in `renderRunningRows`, after the label span:

```js
        (run.progress ? `<span class="running-progress">${escapeHtml(run.progress)}</span>` : '') +
```

`app.js`:
- `trackRun(runId, label, total = null)` stores `{ runId, label, line: '', stopping: false, total, progress: '' }`.
- in `runWorkflowCommand`: `const { skipBackgroundRefresh = false, progressTotal = null } = options` and `trackRun(runId, actionLabel(commandName), progressTotal)`.
- next to `api.onCommandActivity`:

```js
api.onCommandProgress(({ runId, done }) => {
  const run = state.activeRuns.get(runId)
  if (!run) {
    return
  }
  run.progress = formatProgress(done, run.total)
  const span = elements.runningCommands.querySelector(`[data-run-row="${CSS.escape(runId)}"] .running-progress`)
  if (span) {
    span.textContent = run.progress
  } else {
    renderRunningCommands()
  }
})
```

- Get handler:

```js
  const paths = parsePaths(elements.paths.value)
  // ponytail: total known only for "get everything" in the root dataset (health counts the root only).
  const progressTotal =
    paths.length === 0 && projectPath === state.rootProjectPath ? state.projectHealthSnapshot?.missingContentCount ?? null : null
  await runWorkflowCommand('get', { projectPath, paths }, elements.getDataButton, undefined, { progressTotal })
```

- [ ] **Step 4: Run** `npm test` → PASS. `npm start`, Get Data on a dataset with many missing files → strip shows "3 of 120 files" counting up.
- [ ] **Step 5: Commit** — `git commit -m "feat: running strip shows files done for Get and Publish"` (+ trailer).

---

## Part F — Add a Remote

Flow: **URL** (GIN/GitHub/GitLab repository created empty on the website, or any git URL) or **Folder** (USB drive, mounted network share; the app creates a bare, annex-initialised repository in an empty folder). Then: add sibling → first Publish with `--to` → set the branch's upstream so Update/Publish light up.

### Task 14: `addRemote` command, `push --to`

**Files:**
- Modify: `src/datalad/schema.js` (schema, leading-dash, the `ext::` check), `src/datalad/adapter.js` (CURATED_COMMANDS, `push` case, new case), `src/datalad/errors.js`
- Test: `test/adapter.test.js`, `test/schema.test.js`, `test/errors.test.js`

**Interfaces:**
- Consumes: `SAFE_NAME_PATTERN`/`isSafeName` (Task 3).
- Produces: curated `'addRemote'` `{ projectPath, remoteName, url }`; `'push'` accepts optional `remoteName`; error `'REMOTE_EXISTS'`.

- [ ] **Step 1: Write the failing tests**

`test/adapter.test.js`:

```js
test('runCommand adds a remote as a DataLad sibling', async () => {
  const runner = new FakeRunner()
  const args = ['siblings', 'add', '-d', '/tmp/project', '-s', 'backup', '--url', '/Volumes/USB/study']
  runner.set('datalad', args, {})

  const result = await new DataLadAdapter({ runner }).runCommand('addRemote', {
    projectPath: '/tmp/project', remoteName: 'backup', url: '/Volumes/USB/study'
  })

  assert.equal(result.ok, true)
  assert.deepEqual(runner.calls[0].args, args)
})

test('addRemote rejects unsafe remote names', async () => {
  const adapter = new DataLadAdapter({ runner: new FakeRunner() })
  for (const remoteName of ['my remote', 'a/b', 'x..y', 'origin.lock']) {
    await assert.rejects(
      adapter.runCommand('addRemote', { projectPath: '/tmp/p', remoteName, url: 'https://x/y' }),
      /remote name/i,
      remoteName
    )
  }
})

test('push can target one named remote', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['-C', '/tmp/project', 'push', '--to', 'backup'], {})

  const result = await new DataLadAdapter({ runner }).runCommand('push', { projectPath: '/tmp/project', remoteName: 'backup' })

  assert.equal(result.ok, true)
})
```

`test/schema.test.js` (it already imports `assertCommandRequest`):

```js
test('addRemote refuses flag-like values and the ext:: transport', () => {
  assert.throws(() => assertCommandRequest('addRemote', { projectPath: '/p', remoteName: '-x', url: 'https://a' }), /cannot start with -/)
  assert.throws(() => assertCommandRequest('addRemote', { projectPath: '/p', remoteName: 'x', url: '--upload-pack=evil' }), /cannot start with -/)
  assert.throws(() => assertCommandRequest('addRemote', { projectPath: '/p', remoteName: 'x', url: 'ext::sh -c evil' }), /ext:: transport/)
})
```

`test/errors.test.js`:

```js
test('mapCommandError maps a remote name that is already taken', () => {
  const result = mapCommandError('addRemote', { stderr: "fatal: remote origin already exists." })
  assert.equal(result.code, 'REMOTE_EXISTS')
})
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`schema.js`:

```js
  addRemote: {
    required: ['projectPath', 'remoteName', 'url'],
    optional: []
  },
```

`push` becomes `optional: ['remoteName']`; leading-dash entries `addRemote: ['remoteName', 'url'],` and `push: ['remoteName'],`; generalise the `ext::` check:

```js
  const transportField = { cloneInstall: 'source', addRemote: 'url' }[commandName]
  if (transportField && /^\s*ext::/i.test(request[transportField])) {
    throw new Error(`Invalid request for ${commandName}: the ext:: transport is not allowed`)
  }
```

(the existing cloneInstall test's expected message `the ext:: transport is not allowed` still matches.)

`adapter.js` — `'addRemote'` in `CURATED_COMMANDS`; `push` case:

```js
      case 'push': {
        const projectPath = request.projectPath
        const args = ['-C', projectPath, 'push']
        if (request.remoteName) {
          args.push('--to', request.remoteName)
        }
        return { command: 'datalad', args, options: { cwd: projectPath } }
      }
```

new case:

```js
      case 'addRemote': {
        const { projectPath, remoteName, url } = request
        if (!isSafeName(remoteName)) {
          throw new Error(`Invalid remote name: ${remoteName}. Use letters, digits, dot, dash or underscore.`)
        }
        return {
          command: 'datalad',
          args: ['siblings', 'add', '-d', projectPath, '-s', remoteName, '--url', url],
          options: { cwd: projectPath }
        }
      }
```

`errors.js` — before the generic `REMOTE_MISSING` check:

```js
  if (commandName === 'addRemote' && hasPattern(`${stdout}\n${stderr}`, /already (exists|present|configured)/)) {
    return {
      code: 'REMOTE_EXISTS',
      title: 'That remote name is already used',
      message: 'This project already has a remote with this name. Pick a different name.',
      technicalDetails: details || stdout.trim()
    }
  }
```

- [ ] **Step 4: Run** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: addRemote command and push --to"` (+ trailer).

### Task 15: `prepareFolderRemote` and `trackRemote`

**Files:**
- Modify: `src/datalad/adapter.js` (two public methods after `clearRepositoryLock`)
- Test: `test/adapter.test.js`

**Interfaces:**
- Produces: `adapter.prepareFolderRemote(folderPath: string) → { ok: true, folderPath }` (throws on failure); `adapter.trackRemote(projectPath: string, remoteName: string) → { ok: true, upstream: string }` (throws on failure).

- [ ] **Step 1: Write the failing tests**

```js
test('prepareFolderRemote creates an annex-ready bare repository so the first Publish carries data', async () => {
  const runner = new FakeRunner()
  runner.set('git', ['init', '--bare', '--', '/Volumes/USB/study'], {})
  runner.set('git', ['-C', '/Volumes/USB/study', 'annex', 'init', 'DataLad Desktop backup'], {})

  assert.deepEqual(await new DataLadAdapter({ runner }).prepareFolderRemote('/Volumes/USB/study'), {
    ok: true, folderPath: '/Volumes/USB/study'
  })
  assert.equal(runner.calls.length, 2)
})

test('prepareFolderRemote stops at the first failing step', async () => {
  const runner = new FakeRunner() // git init unmocked => fails
  await assert.rejects(new DataLadAdapter({ runner }).prepareFolderRemote('/x'), /Could not prepare/)
  assert.equal(runner.calls.length, 1)
})

test('trackRemote points the current branch at the remote (adjusted branches track their base)', async () => {
  const runner = new FakeRunner()
  runner.set('git', ['-C', '/p', 'branch', '--show-current'], { stdout: 'adjusted/main(unlocked)\n' })
  runner.set('git', ['-C', '/p', 'branch', '--set-upstream-to=backup/main'], {})

  assert.deepEqual(await new DataLadAdapter({ runner }).trackRemote('/p', 'backup'), { ok: true, upstream: 'backup/main' })
})

test('trackRemote refuses an unsafe remote name', async () => {
  await assert.rejects(new DataLadAdapter({ runner: new FakeRunner() }).trackRemote('/p', '-x'), /remote name/i)
})
```

- [ ] **Step 2: Run** — FAIL (`not a function`).

- [ ] **Step 3: Implement** in `DataLadAdapter`:

```js
  // An empty folder (USB drive, mounted share) becomes a bare repository. git-annex must be initialised
  // in it up front, or the first `datalad push` sends history only and no data (verified with DataLad 1.6).
  async prepareFolderRemote(folderPath) {
    for (const args of [
      ['init', '--bare', '--', folderPath],
      ['-C', folderPath, 'annex', 'init', 'DataLad Desktop backup']
    ]) {
      const result = await this.runner.run('git', args)
      if (result.failed) {
        throw new Error(`Could not prepare ${folderPath}: ${(result.stderr || result.stdout).trim()}`)
      }
    }
    return { ok: true, folderPath }
  }

  // After the first `push --to`, make that remote the branch's upstream so Update/Publish use it.
  async trackRemote(projectPath, remoteName) {
    if (!isSafeName(remoteName)) {
      throw new Error(`Invalid remote name: ${remoteName}`)
    }
    const current = this.#firstLine((await this.runner.run('git', ['-C', projectPath, 'branch', '--show-current'])).stdout)
    if (!current) {
      throw new Error('Not on a branch: switch to a branch first.')
    }
    // Windows datasets sit on "adjusted/<branch>(unlocked)"; datalad pushes <branch> itself.
    const branch = current.replace(/^adjusted\//, '').replace(/\([^)]*\)$/, '')
    const upstream = `${remoteName}/${branch}`
    const result = await this.runner.run('git', ['-C', projectPath, 'branch', `--set-upstream-to=${upstream}`])
    if (result.failed) {
      throw new Error(`Could not connect the branch to ${upstream}: ${(result.stderr || result.stdout).trim()}`)
    }
    return { ok: true, upstream }
  }
```

- [ ] **Step 4: Run** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: prepare folder remotes and track the new remote"` (+ trailer).

### Task 16: main-process handlers

**Files:**
- Modify: `src/gui/main.js` (after `adapter:clearRepositoryLock`), `src/gui/preload.js`
- Test: `test/trust-wiring.test.js`

**Interfaces:**
- Consumes: `prepareFolderRemote`, `trackRemote` (Task 15); existing `isEmptyOrMissing`, `pickedLocations`, `confirmNative`, `trustGate().createdByApp`, `requireAuthorizedRoot`.
- Produces: IPC `adapter:prepareFolderRemote` (payload: folder path string), `adapter:trackRemote` (`{ projectPath, remoteName }`); preload `prepareFolderRemote(folderPath)`, `trackRemote(projectPath, remoteName)`.

- [ ] **Step 1: Write the failing tests** in `test/trust-wiring.test.js`:

```js
test('a folder remote is only ever created in an empty folder, confirmed when not picked, then trusted as app-made', () => {
  const body = block("handle('adapter:prepareFolderRemote'")
  const empty = body.indexOf('isEmptyOrMissing(folderPath)')
  const prepare = body.indexOf('adapter.prepareFolderRemote')
  assert.ok(empty !== -1 && empty < prepare, 'emptiness is checked before anything is written')
  assert.match(body, /isWithinRoots\(folderPath, pickedLocations\)[\s\S]*?confirmNative\(/)
  assert.ok(body.indexOf('createdByApp(folderPath)') > prepare)
})

test('trackRemote requires an opened project', () => {
  assert.match(block("handle('adapter:trackRemote'"), /requireAuthorizedRoot\(payload\.projectPath\)/)
})
```

- [ ] **Step 2: Run** — `node --test test/trust-wiring.test.js` → FAIL (`missing handle('adapter:prepareFolderRemote'`).

- [ ] **Step 3: Implement** `main.js`:

```js
// Writes a new repository into a folder the user chose (USB drive, share). Never into one with content.
handle('adapter:prepareFolderRemote', async (event, folderPath) => {
  if (typeof folderPath !== 'string' || !folderPath.trim()) {
    throw new Error('Choose a folder first.')
  }
  if (!(await isEmptyOrMissing(folderPath))) {
    throw new Error('Choose an empty folder: this one already has files in it.')
  }
  if (!isWithinRoots(folderPath, pickedLocations)) {
    const ok = await confirmNative(event, {
      title: 'Create a backup copy here?',
      message: 'This folder was typed, not picked.',
      detail: `${folderPath}\n\nA copy of the project will be stored in it.`,
      confirmLabel: 'Use this folder'
    })
    if (!ok) {
      throw new Error('Not created: the location was not confirmed.')
    }
  }
  const result = await adapter.prepareFolderRemote(folderPath)
  // Publish re-checks a local remote's trust; this one the app made itself, empty.
  trustGate().createdByApp(folderPath)
  return result
})

handle('adapter:trackRemote', async (_event, payload = {}) => {
  requireAuthorizedRoot(payload.projectPath)
  return adapter.trackRemote(payload.projectPath, payload.remoteName)
})
```

`preload.js`:

```js
  prepareFolderRemote: (folderPath) => ipcRenderer.invoke('adapter:prepareFolderRemote', folderPath),
  trackRemote: (projectPath, remoteName) => ipcRenderer.invoke('adapter:trackRemote', { projectPath, remoteName }),
```

- [ ] **Step 4: Run** — `npm test` → PASS (check the existing "authorizeRoot only once" and "createdByApp once in runCommand" tests still pass; the new `createdByApp` call is outside that block).
- [ ] **Step 5: Commit** — `git commit -m "feat: IPC for folder remotes and remote tracking"` (+ trailer).

### Task 17: Add-a-Remote UI

**Files:**
- Modify: `src/gui/renderer/button-gating.js` (`computeRemoteGating`), `src/gui/renderer/index.html:454-460`, `src/gui/renderer/app.js` (`applyRemoteGatedButtons` ~3073, new handlers), `actionLabel`
- Test: `test/button-gating.test.js`

**Interfaces:**
- Consumes: `'addRemote'`, `'push'` with `remoteName` (Task 14); `api.prepareFolderRemote`, `api.trackRemote` (Task 16); `api.pickDirectory` (existing).
- Produces: `computeRemoteGating(health).addRemote = { hidden: boolean }`.

- [ ] **Step 1: Write the failing test**

```js
test('computeRemoteGating offers Add a Remote only when there is none', () => {
  assert.equal(computeRemoteGating({ hasUpstream: false }).addRemote.hidden, false)
  assert.equal(computeRemoteGating({ hasUpstream: true, upstream: 'origin/main' }).addRemote.hidden, true)
})
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`button-gating.js`: add `addRemote: { hidden: false }` to the no-remote return and `addRemote: { hidden: true }` to the has-remote return; update the JSDoc return type.

Also update `computeSyncActionsQuietMessage`'s copy: `'add a remote'` → `'use Add a Remote below'` in both strings (and the matching assertions in `test/button-gating.test.js`).

`index.html`, after `#remote-info`:

```html
          <details id="add-remote" class="branch-details" hidden>
            <summary>Add a Remote</summary>
            <p class="lede-small">
              Keep a second copy on a USB drive or network share, or connect an empty repository you created on
              GIN, GitHub or GitLab. The first Publish sends everything.
            </p>
            <div class="field-row">
              <label><input type="radio" name="add-remote-mode" id="add-remote-mode-folder" value="folder" checked /> Folder</label>
              <label><input type="radio" name="add-remote-mode" id="add-remote-mode-url" value="url" /> Repository URL</label>
            </div>
            <label class="field">
              <span>Location</span>
              <div class="field-row">
                <input id="add-remote-location" type="text" placeholder="/Volumes/USB/my-study  or  https://gin.g-node.org/me/my-study" />
                <button id="add-remote-browse" class="button button-ghost button-inline" type="button">Browse</button>
              </div>
            </label>
            <label class="field">
              <span>Name</span>
              <input id="add-remote-name" type="text" value="backup" />
            </label>
            <button id="add-remote-connect" class="button button-primary" type="button">Connect and Publish</button>
          </details>
```

`app.js` — elements `addRemote`, `addRemoteModeFolder`, `addRemoteLocation`, `addRemoteBrowse`, `addRemoteName`, `addRemoteConnect`; in `applyRemoteGatedButtons`: `elements.addRemote.hidden = gating.addRemote.hidden || !state.rootProjectPath`; handlers:

```js
elements.addRemoteBrowse.addEventListener('click', async () => {
  const picked = await api.pickDirectory({ title: 'Choose an empty folder for the copy' })
  if (picked) {
    elements.addRemoteLocation.value = picked
    elements.addRemoteModeFolder.checked = true
  }
})

elements.addRemoteConnect.addEventListener('click', async () => {
  const projectPath = readProjectPath()
  const location = elements.addRemoteLocation.value.trim()
  const remoteName = elements.addRemoteName.value.trim()
  if (!projectPath) {
    return
  }
  if (!location || !remoteName) {
    setLastActionState('Enter a location and a name first.', 'error')
    return
  }

  try {
    if (elements.addRemoteModeFolder.checked) {
      await api.prepareFolderRemote(location)
    }
    const added = await runWorkflowCommand('addRemote', { projectPath, remoteName, url: location }, elements.addRemoteConnect)
    if (!added?.ok) {
      return
    }
    const pushed = await runWorkflowCommand('push', { projectPath, remoteName }, elements.addRemoteConnect)
    if (!pushed?.ok) {
      return
    }
    await api.trackRemote(projectPath, remoteName)
    setLastActionState(`Connected to ${remoteName} and published.`, 'success')
  } catch (error) {
    elements.commandOutput.textContent = String(error.message)
    setLastActionState('Add a Remote failed.', 'error')
  } finally {
    await refreshProjectHealth(projectPath)
  }
})
```

`actionLabel`: `addRemote` → `'Add a Remote'`.

Note: `pickDirectory` returns an empty folder without a trust prompt and records it in `pickedLocations`, which is what lets `prepareFolderRemote` skip its confirmation for picked folders.

- [ ] **Step 4: Run** `npm test` → PASS. `npm start`: on a dataset with no remote, Add a Remote → Browse → pick an empty folder → Connect and Publish → Update/Publish become enabled and `Remote: backup/main (...)` shows.
- [ ] **Step 5: Commit** — `git commit -m "feat: Add a Remote (folder or repository URL)"` (+ trailer).

---

## Part G — End-to-end proof

### Task 18: one real-annex round trip

**Files:**
- Create: `e2e/science-workflow.e2e.mjs`

**Interfaces:**
- Consumes: every DOM id above; `launchApp` from `e2e/electron-driver.mjs` (same usage as `e2e/real-annex-roundtrip.e2e.mjs`).

- [ ] **Step 1: Write the spec** (it needs real DataLad, like `real-annex-roundtrip.e2e.mjs`):

```js
// Needs a real DataLad + git-annex (like real-annex-roundtrip.e2e.mjs). Proves the six science-workflow
// additions against real tools: add folder remote → publish with data → version tag reaches the remote →
// verify → free up space → provenance shown.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'

let app
let root
let projectPath
let backupPath

const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8' })
const idle = (id, label) =>
  app.page.waitForFunction(
    ([elementId, text]) => {
      const el = document.getElementById(elementId)
      return el && !el.disabled && el.textContent.trim() === text
    },
    [id, label],
    { timeout: 60_000 }
  )

test.before(async () => {
  root = await mkdtemp(join(tmpdir(), 'dlad-e2e-science-'))
  projectPath = join(root, 'study')
  backupPath = join(root, 'usb')
  await mkdir(backupPath)
  sh('datalad', ['create', projectPath])
  await writeFile(join(projectPath, 'data.bin'), 'x'.repeat(4096))
  sh('datalad', ['save', '-m', 'add data'], projectPath)
  sh('datalad', ['run', '-m', 'size', 'wc -c data.bin > size.txt'], projectPath)
  app = await launchApp({ trustedPaths: [projectPath] })
  await app.openProject(projectPath)
})

test.after(async () => {
  await app?.close()
})

test('Add a Remote creates an annex-ready folder copy and publishes the data to it', async () => {
  await app.page.evaluate((path) => {
    document.getElementById('add-remote').open = true
    document.getElementById('add-remote-location').value = path
    document.getElementById('add-remote-connect').click()
  }, backupPath)
  await idle('add-remote-connect', 'Connect and Publish')

  const whereis = sh('git', ['annex', 'whereis', 'data.bin'], projectPath)
  assert.match(whereis, /2 copies/, await app.page.evaluate(() => document.getElementById('command-output')?.textContent))
})

test('Check Data Integrity reports all files intact', async () => {
  await app.page.evaluate(() => document.getElementById('verify-data').click())
  await idle('verify-data', 'Check Data Integrity')
  const text = await app.page.evaluate(() => document.getElementById('verify-output').textContent)
  assert.match(text, /intact/)
})

test('Free Up Space removes the local copy now that the backup has one', async () => {
  await app.page.evaluate(() => {
    window.confirm = () => true
    document.getElementById('paths').value = 'data.bin'
    document.getElementById('drop-data').click()
  })
  await idle('drop-data', 'Free Up Space')
  assert.equal(sh('git', ['annex', 'find', '--in', 'here', 'data.bin'], projectPath).trim(), '')
})

test('a version marked in git reaches the remote on Publish', async () => {
  sh('git', ['tag', '-a', 'v1.0', '-m', 'Version v1.0'], projectPath) // the UI path is covered by unit tests
  await app.page.evaluate(() => document.getElementById('publish-project').click())
  await idle('publish-project', 'Publish (remote)')
  assert.match(sh('git', ['tag'], backupPath), /v1\.0/)
})

test('Time Machine marks the datalad run commit and shows its command', async () => {
  await app.page.evaluate(() => document.querySelector('[data-nav-target="time-machine-zone"]').click())
  await app.page.waitForSelector('.run-chip', { timeout: 30_000 })
  await app.page.evaluate(() => document.querySelector('.tm-commit-item .run-chip').closest('.tm-commit-item').click())
  await app.page.waitForSelector('.tm-run-record pre', { timeout: 30_000 })
  assert.match(await app.page.evaluate(() => document.querySelector('.tm-run-record pre').textContent), /wc -c data\.bin/)
})
```

The e2e driver only auto-answers the app's *native* dialogs, not `window.confirm`, hence the override in the drop test.

- [ ] **Step 2: Run** — `node --test e2e/science-workflow.e2e.mjs` → all five PASS. If the `whereis` test fails with "1 copy", the folder remote was not annex-initialised; check Task 15.
- [ ] **Step 3: Full suite** — `npm test` and `npm run test:e2e` → PASS.
- [ ] **Step 4: Commit** — `git commit -m "test: e2e round trip for the science workflow additions"` (+ trailer).

---

## Out of scope (deliberately)

- `datalad rerun` — executes a command from history; CLI users have it.
- Byte-level progress — needs `git annex get --json-progress` in place of `datalad get`, losing subdataset handling.
- Integrity check across nested subdatasets — per-dataset for now (`ponytail:` comment in Task 7).
- Creating repositories on GIN/GitHub via API — needs tokens/credential management.
