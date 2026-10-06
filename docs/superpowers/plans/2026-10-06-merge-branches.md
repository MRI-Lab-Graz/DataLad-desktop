# Merge Branches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a researcher merge a local branch into the current branch from Project Setup, resolve conflicting files by picking a side, and finish or cancel the merge, without a terminal.

**Architecture:** Three new single-git-command adapter commands (`merge`, `finishMerge`, `abortMerge`) go through the existing `runCommand` path. Two multi-step operations (`resolveConflict`, `syncSubdatasets`) are adapter methods, like `untrackPath`. `getWorkingTreeStatus` reports `mergeInProgress`, `mergeBranch` and per-file `sides`; a pure renderer module turns that into a banner model. All git calls use the existing process runner (app-owned hooks, literal pathspecs).

**Tech Stack:** Node ESM, Electron renderer (plain DOM, strict CSP: no inline handlers), Node built-in test runner (`npm test`), real `git` in temp repos for integration tests.

**Spec:** `docs/superpowers/specs/2026-10-06-merge-branches-design.md`

## Global Constraints

- TDD for every function (CLAUDE.md): failing test first, run it red, then implement. Tests: `npm test`; one file: `node --test test/<file>.test.js`.
- Zero new npm dependencies (project posture). No new execution surface: git only, via `this.runner.run('git', …)`; never a shell.
- Work on branch `release/v0.5.0` (this blocks the release). Commit after every task. End each commit message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- All text that reaches the DOM goes through `escapeHtml` (`src/gui/renderer/escape-html.js`); no inline `on…=` handlers (CSP).
- Researcher-facing wording: "branch", "version", "save"; never "ours/theirs/stage/index". Button labels exactly: `Merge`, `Keep this branch's version`, `Keep <other>'s version`, `I fixed it myself`, `Cancel Merge`, `Finish Merge`, field label `Merge Into Current Branch`.
- Conflict detection must not depend on git's English output: use `MERGE_HEAD`.
- Merge is local-only: it is NOT added to `PUSHES` in `src/gui/main.js`.

**Deviations from the spec (decided while planning; Task 9 amends the spec):**
1. `resolveConflict` and the subdataset sync need several git calls, so they are adapter methods with an IPC handler (`adapter:resolveConflict`), not `COMMAND_SCHEMAS` commands. The sync runs inside `runCommand` after a successful `merge`/`finishMerge` (same cancellable run) and returns its notes as `warnings`.
2. "I fixed it myself" refuses only when a file has both a `<<<<<<< ` line and a `>>>>>>> ` line (a lone `=======` is a normal Markdown heading).
3. During a merge the Save button is both hidden and disabled with guidance (`computeSaveGating`).
4. Merge state is read from `MERGE_HEAD` (`git rev-parse -q --verify MERGE_HEAD`), also before a merge starts (refuse if one is already open).

## Review Focus

Inputs the spec implies but no happy path exercises, most likely first. Each has a test in the task named.

1. A conflicted file whose name has spaces or starts with `-` (`-odd name.txt`): resolution must treat it as a path (Task 4).
2. Merge started while HEAD is detached (after browsing Time Machine) or while a merge is already open: a plain-language refusal, nothing run (Task 2).
3. A non-English git: conflict detection must still work (Task 2 uses `MERGE_HEAD`, and its test feeds localized stdout).
4. A subdataset with uncommitted work, or whose recorded commit is not a fast-forward, must never be moved or overwritten (Task 5).
5. A new untracked file that the merge would overwrite: git refuses, the researcher sees which files (Task 2).
6. A conflict where one side deleted the file: "keep this version" must remove it, not fail (Task 4).

---

### Task 1: Merge commands in the schema and adapter

**Files:**
- Modify: `src/datalad/schema.js` (add 3 schemas; `LEADING_DASH_FIELDS`)
- Modify: `src/datalad/adapter.js` (`CURATED_COMMANDS`, `#buildCommand`)
- Modify: `src/gui/renderer/identity-guard.js:6`
- Create: `test/merge-real-git.test.js`
- Test: `test/schema.test.js`, `test/adapter.test.js`, `test/identity-guard.test.js`

**Interfaces:**
- Produces: commands `merge` `{projectPath, branchName}`, `finishMerge` `{projectPath}`, `abortMerge` `{projectPath}` accepted by `adapter.runCommand`.
- Produces (test helpers in `test/merge-real-git.test.js`, used by Tasks 2–5): `makeRepo()` → `{ dir, git(...args), write(name, text), adapter }`, `conflictingRepo()` → repo on `main` where `main` and `feature` both changed `file.txt` (`main` text `main\n`, `feature` text `feature\n`).

- [ ] **Step 1: Write the failing tests**

Append to `test/schema.test.js` (use the file's existing imports; if it lacks `assertCommandRequest`, import it from `../src/datalad/schema.js`):

```js
test('merge needs a project and a branch, and a branch cannot be an option', () => {
  assert.doesNotThrow(() => assertCommandRequest('merge', { projectPath: '/p', branchName: 'feature' }))
  assert.throws(() => assertCommandRequest('merge', { projectPath: '/p' }), /branchName/)
  assert.throws(() => assertCommandRequest('merge', { projectPath: '/p', branchName: '--abort' }), /cannot start with -/)
  assert.doesNotThrow(() => assertCommandRequest('finishMerge', { projectPath: '/p' }))
  assert.doesNotThrow(() => assertCommandRequest('abortMerge', { projectPath: '/p' }))
})
```

Append to `test/adapter.test.js` (`FakeRunner` is defined at the top of that file). The `symbolic-ref` mock is the "on a branch" check that Task 2 adds; it is harmless now:

```js
test('runCommand routes merge to git merge --no-edit with the branch after --', async () => {
  const runner = new FakeRunner()
  runner.set('git', ['-C', '/tmp/project', 'symbolic-ref', '-q', 'HEAD'], { stdout: 'refs/heads/main\n' })
  runner.set('git', ['-C', '/tmp/project', 'merge', '--no-edit', '--', 'feature'], { stdout: 'Merge made\n' })
  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('merge', { projectPath: '/tmp/project', branchName: 'feature' })
  assert.equal(result.ok, true)
  assert.ok(runner.calls.some((c) => c.args.join(' ') === '-C /tmp/project merge --no-edit -- feature'))
})

test('runCommand routes finishMerge and abortMerge to git commit --no-edit and git merge --abort', async () => {
  const runner = new FakeRunner()
  runner.set('git', ['-C', '/tmp/project', 'commit', '--no-edit'], {})
  runner.set('git', ['-C', '/tmp/project', 'merge', '--abort'], {})
  const adapter = new DataLadAdapter({ runner })
  assert.equal((await adapter.runCommand('finishMerge', { projectPath: '/tmp/project' })).ok, true)
  assert.equal((await adapter.runCommand('abortMerge', { projectPath: '/tmp/project' })).ok, true)
})
```

Append to `test/identity-guard.test.js` (it imports `shouldBlockForIdentity`; add it if missing):

```js
test('merge and finishMerge create a commit, so they wait for an identity', () => {
  const missing = { available: true, complete: false }
  assert.equal(shouldBlockForIdentity('merge', missing), true)
  assert.equal(shouldBlockForIdentity('finishMerge', missing), true)
  assert.equal(shouldBlockForIdentity('abortMerge', missing), false)
})
```

Create `test/merge-real-git.test.js`:

```js
// Real git and the real runner (no fake), like own-tags-real-git.test.js: merge behaviour is git's, so it is checked there.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataLadAdapter } from '../src/datalad/adapter.js'
import { ProcessRunner } from '../src/datalad/process-runner.js'

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'dlad-merge-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'ana@example.org')
  git('config', 'user.name', 'Ana')
  git('config', 'commit.gpgsign', 'false')
  return { dir, git, write: (name, text) => writeFile(join(dir, name), text), adapter: new DataLadAdapter({ runner: new ProcessRunner() }) }
}

// main and feature both changed file.txt: the classic conflict. Left on main.
async function conflictingRepo(fileName = 'file.txt') {
  const r = await makeRepo()
  await r.write(fileName, 'base\n')
  r.git('add', '--', '.')
  r.git('commit', '-qm', 'base')
  r.git('checkout', '-qb', 'feature')
  await r.write(fileName, 'feature\n')
  r.git('commit', '-qam', 'feature edit')
  r.git('checkout', '-q', 'main')
  await r.write(fileName, 'main\n')
  r.git('commit', '-qam', 'main edit')
  return r
}

const merge = (r, branchName = 'feature') => r.adapter.runCommand('merge', { projectPath: r.dir, branchName })
const text = (r, name = 'file.txt') => readFile(join(r.dir, name), 'utf8')

test('merging a branch that is ahead fast-forwards', async () => {
  const r = await makeRepo()
  await r.write('a.txt', 'a\n')
  r.git('add', '--', '.')
  r.git('commit', '-qm', 'base')
  r.git('checkout', '-qb', 'feature')
  await r.write('b.txt', 'b\n')
  r.git('add', '--', '.')
  r.git('commit', '-qm', 'more')
  r.git('checkout', '-q', 'main')

  const result = await merge(r)
  assert.equal(result.ok, true, result.stderr)
  assert.equal(await text(r, 'b.txt'), 'b\n')
})

test('merging branches that changed different files makes a merge commit', async () => {
  const r = await makeRepo()
  await r.write('a.txt', 'a\n')
  r.git('add', '--', '.')
  r.git('commit', '-qm', 'base')
  r.git('checkout', '-qb', 'feature')
  await r.write('b.txt', 'b\n')
  r.git('add', '--', '.')
  r.git('commit', '-qm', 'feature')
  r.git('checkout', '-q', 'main')
  await r.write('a.txt', 'a2\n')
  r.git('commit', '-qam', 'main')

  const result = await merge(r)
  assert.equal(result.ok, true, result.stderr)
  assert.match(r.git('log', '-1', '--format=%s'), /^Merge branch 'feature'/)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/schema.test.js test/adapter.test.js test/identity-guard.test.js test/merge-real-git.test.js`
Expected: FAIL (`Unsupported command: merge`, identity assertions false).

- [ ] **Step 3: Implement**

`src/datalad/schema.js`, in `COMMAND_SCHEMAS` after `createBranchAt`:

```js
  merge: {
    required: ['projectPath', 'branchName'],
    optional: []
  },
  finishMerge: {
    required: ['projectPath'],
    optional: []
  },
  abortMerge: {
    required: ['projectPath'],
    optional: []
  },
```

and in `LEADING_DASH_FIELDS` add `merge: ['branchName'],`.

`src/datalad/adapter.js`: add `'merge', 'finishMerge', 'abortMerge'` to `CURATED_COMMANDS`; in `#buildCommand` after `createBranchAt`:

```js
      case 'merge': {
        return {
          command: 'git',
          args: ['-C', request.projectPath, 'merge', '--no-edit', '--', request.branchName],
          options: { cwd: request.projectPath }
        }
      }
      case 'finishMerge': {
        return {
          command: 'git',
          args: ['-C', request.projectPath, 'commit', '--no-edit'],
          options: { cwd: request.projectPath }
        }
      }
      case 'abortMerge': {
        return {
          command: 'git',
          args: ['-C', request.projectPath, 'merge', '--abort'],
          options: { cwd: request.projectPath }
        }
      }
```

`src/gui/renderer/identity-guard.js` line 6: add `'merge', 'finishMerge'` to `COMMIT_COMMANDS`, and extend the comment above it to say merge and finishMerge create a merge commit.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/schema.test.js test/adapter.test.js test/identity-guard.test.js test/merge-real-git.test.js && npm test 2>&1 | grep -E '^ℹ (pass|fail)'`
Expected: PASS, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat: merge, finishMerge and abortMerge commands" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Conflicts are a state, refusals are plain language

**Files:**
- Modify: `src/datalad/adapter.js` (`runCommand`, two private helpers)
- Modify: `src/datalad/errors.js` (export `MERGE_PREFLIGHT_ERRORS`; map merge/finishMerge errors)
- Test: `test/adapter.test.js`, `test/errors.test.js`, `test/merge-real-git.test.js`

**Interfaces:**
- Consumes: Task 1 commands and helpers.
- Produces: `runCommand('merge')` returns `{ ok: true, conflicts: true, … }` when git stops on conflicts; `{ ok: false, userError: { code: 'DETACHED_HEAD' | 'MERGE_IN_PROGRESS' | 'MERGE_UNTRACKED_OVERWRITE' | 'MERGE_UNRELATED' | 'WORKTREE_DIRTY' } }` on refusals; `runCommand('finishMerge')` failing with unmerged files maps to `MERGE_UNRESOLVED`. `errors.js` exports `MERGE_PREFLIGHT_ERRORS = { DETACHED_HEAD, MERGE_IN_PROGRESS }` (each a full `userError` object). Private `#mergeInProgress(projectPath)` → boolean (reused by Task 3).

- [ ] **Step 1: Write the failing tests**

Append to `test/errors.test.js` (it imports `mapCommandError`):

```js
test('mapCommandError maps merge refusals to plain language', () => {
  const untracked = mapCommandError('merge', {
    stderr: 'error: The following untracked working tree files would be overwritten by merge:\n\tnew.txt\nPlease move or remove them before you merge.'
  })
  assert.equal(untracked.code, 'MERGE_UNTRACKED_OVERWRITE')
  assert.match(untracked.technicalDetails, /new\.txt/)
  assert.equal(mapCommandError('merge', { stderr: 'fatal: refusing to merge unrelated histories' }).code, 'MERGE_UNRELATED')
  assert.equal(mapCommandError('merge', { stderr: 'error: Your local changes to the following files would be overwritten by merge:\n\ta.txt' }).code, 'WORKTREE_DIRTY')
  assert.equal(mapCommandError('finishMerge', { stderr: 'fatal: Exiting because of an unresolved conflict.' }).code, 'MERGE_UNRESOLVED')
  assert.equal(mapCommandError('finishMerge', { stderr: 'error: Committing is not possible because you have unmerged files.' }).code, 'MERGE_UNRESOLVED')
})
```

Append to `test/adapter.test.js`. A scripted runner answers calls in order, so one test can see "before" and "after" states:

```js
function scriptedRunner(script) {
  const calls = []
  return {
    calls,
    async run(command, args = []) {
      calls.push({ command, args })
      const step = script.shift()
      assert.ok(step, `unexpected extra call: ${command} ${args.join(' ')}`)
      return { command, args, exitCode: step.failed ? 1 : 0, stdout: '', stderr: '', failed: false, ...step }
    }
  }
}

test('merge stops with a plain message on a detached HEAD and runs no merge', async () => {
  const runner = scriptedRunner([{ failed: true }]) // git symbolic-ref -q HEAD fails
  const result = await new DataLadAdapter({ runner }).runCommand('merge', { projectPath: '/p', branchName: 'feature' })
  assert.equal(result.ok, false)
  assert.equal(result.userError.code, 'DETACHED_HEAD')
  assert.equal(runner.calls.length, 1)
})

test('merge refuses while another merge is open', async () => {
  const runner = scriptedRunner([{ stdout: 'refs/heads/main\n' }, { stdout: 'abc123\n' }]) // MERGE_HEAD exists
  const result = await new DataLadAdapter({ runner }).runCommand('merge', { projectPath: '/p', branchName: 'feature' })
  assert.equal(result.userError.code, 'MERGE_IN_PROGRESS')
  assert.equal(runner.calls.length, 2)
})

test('a merge that stops on conflicts is ok with conflicts: true, whatever language git speaks', async () => {
  const runner = scriptedRunner([
    { stdout: 'refs/heads/main\n' }, // symbolic-ref
    { failed: true }, // MERGE_HEAD absent: nothing open
    { failed: true, stdout: 'KONFLIKT (Inhalt): Merge-Konflikt in a.txt\n' }, // merge exits 1
    { stdout: 'abc123\n' } // MERGE_HEAD now exists
  ])
  const result = await new DataLadAdapter({ runner }).runCommand('merge', { projectPath: '/p', branchName: 'feature' })
  assert.equal(result.ok, true)
  assert.equal(result.conflicts, true)
})

test('a merge that fails without leaving MERGE_HEAD is a real failure', async () => {
  const runner = scriptedRunner([
    { stdout: 'refs/heads/main\n' },
    { failed: true },
    { failed: true, stderr: 'fatal: refusing to merge unrelated histories' },
    { failed: true }
  ])
  const result = await new DataLadAdapter({ runner }).runCommand('merge', { projectPath: '/p', branchName: 'feature' })
  assert.equal(result.ok, false)
  assert.equal(result.userError.code, 'MERGE_UNRELATED')
})
```

Append to `test/merge-real-git.test.js`:

```js
test('a conflicting merge is ok with conflicts: true and leaves the merge open', async () => {
  const r = await conflictingRepo()
  const result = await merge(r)
  assert.equal(result.ok, true)
  assert.equal(result.conflicts, true)
  assert.match(await text(r), /<<<<<<< /)
})

test('merge refuses on a detached HEAD', async () => {
  const r = await conflictingRepo()
  r.git('checkout', '-q', '--detach')
  const result = await merge(r)
  assert.equal(result.ok, false)
  assert.equal(result.userError.code, 'DETACHED_HEAD')
})

test('merge refuses while a merge is already open', async () => {
  const r = await conflictingRepo()
  await merge(r)
  const again = await merge(r)
  assert.equal(again.ok, false)
  assert.equal(again.userError.code, 'MERGE_IN_PROGRESS')
})

test('unrelated histories are refused in plain language', async () => {
  const r = await conflictingRepo()
  r.git('checkout', '-q', '--orphan', 'other')
  r.git('rm', '-rfq', '--', '.')
  await r.write('x.txt', 'x\n')
  r.git('add', '--', '.')
  r.git('commit', '-qm', 'unrelated root')
  r.git('checkout', '-q', 'main')
  const result = await merge(r, 'other')
  assert.equal(result.ok, false)
  assert.equal(result.userError.code, 'MERGE_UNRELATED')
})

test('an untracked file the merge would overwrite is refused and named', async () => {
  const r = await makeRepo()
  await r.write('a.txt', 'a\n')
  r.git('add', '--', '.')
  r.git('commit', '-qm', 'base')
  r.git('checkout', '-qb', 'feature')
  await r.write('new.txt', 'from feature\n')
  r.git('add', '--', '.')
  r.git('commit', '-qm', 'adds new.txt')
  r.git('checkout', '-q', 'main')
  await r.write('new.txt', 'mine, never saved\n')
  const result = await merge(r)
  assert.equal(result.ok, false)
  assert.equal(result.userError.code, 'MERGE_UNTRACKED_OVERWRITE')
  assert.match(result.userError.technicalDetails, /new\.txt/)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/errors.test.js test/adapter.test.js test/merge-real-git.test.js`
Expected: FAIL (`code` is `UNKNOWN`/undefined, `conflicts` undefined, detached merge not refused).

- [ ] **Step 3: Implement**

`src/datalad/errors.js`: add near the top (after `DEFAULT_ERROR`):

```js
// Raised by the adapter before `git merge` runs (no git output to map).
export const MERGE_PREFLIGHT_ERRORS = Object.freeze({
  DETACHED_HEAD: {
    code: 'DETACHED_HEAD',
    title: 'Not on a branch',
    message: 'Switch to a branch before merging.',
    technicalDetails: ''
  },
  MERGE_IN_PROGRESS: {
    code: 'MERGE_IN_PROGRESS',
    title: 'A merge is already open',
    message: 'Finish or cancel the current merge first.',
    technicalDetails: ''
  }
})
```

and inside `mapCommandError`, immediately **before** the existing `WORKTREE_DIRTY` block (the generic `would be overwritten` pattern there would otherwise catch the untracked case first):

```js
  if (commandName === 'merge' && hasPattern(stderr, /untracked working tree files would be overwritten/)) {
    return {
      code: 'MERGE_UNTRACKED_OVERWRITE',
      title: 'A new file is in the way',
      message:
        'A file here that was never saved has the same name as one on the other branch. Move or rename it, then merge again. The files are listed in the technical details.',
      technicalDetails: details
    }
  }

  if (commandName === 'merge' && hasPattern(stderr, /unrelated histories/)) {
    return {
      code: 'MERGE_UNRELATED',
      title: 'These branches cannot be merged',
      message: 'These two branches share no history, so they cannot be merged here.',
      technicalDetails: details
    }
  }

  if (commandName === 'merge' && hasPattern(stderr, /local changes|would be overwritten|please commit your changes/)) {
    return {
      code: 'WORKTREE_DIRTY',
      title: 'Please save your changes first',
      message: 'The merge would overwrite changes you have not saved. Save your work first, then merge.',
      technicalDetails: details
    }
  }

  if (commandName === 'finishMerge' && hasPattern(stderr, /unmerged files|unresolved conflict/)) {
    return {
      code: 'MERGE_UNRESOLVED',
      title: 'Some files still need a decision',
      message: 'Pick a version for every conflicting file, then finish the merge.',
      technicalDetails: details
    }
  }
```

`src/datalad/adapter.js`: import `MERGE_PREFLIGHT_ERRORS` with `mapCommandError` (`import { mapCommandError, MERGE_PREFLIGHT_ERRORS } from './errors.js'`). In `runCommand`, right after `assertCommandRequest(commandName, request)`:

```js
    if (commandName === 'merge') {
      const refused = await this.#mergePreflight(request.projectPath, runOptions)
      if (refused) {
        return refused
      }
    }
```

and replace the tail (from `if (!result.failed)` to the end of the method) with:

```js
    if (!result.failed) {
      return buildCommandResult(commandName, result, null, warnings)
    }

    // git exits 1 when a merge stops on conflicts. That is a state to resolve, not a failure; MERGE_HEAD (not git's
    // text, which is translated) says which it is.
    if (commandName === 'merge' && (await this.#mergeInProgress(request.projectPath))) {
      return { ...buildCommandResult(commandName, { ...result, failed: false }, null, warnings), conflicts: true }
    }

    return buildCommandResult(commandName, result, mapCommandError(commandName, result), warnings)
```

Add the private helpers next to `#readGitStatus`:

```js
  async #mergeInProgress(projectPath, runOptions) {
    const head = await this.runner.run('git', ['-C', projectPath, 'rev-parse', '-q', '--verify', 'MERGE_HEAD'], runOptions)
    return !head.failed
  }

  // A merge needs a branch to merge into and no other merge open. Returns a finished refusal, or null to go ahead.
  async #mergePreflight(projectPath, runOptions) {
    const head = await this.runner.run('git', ['-C', projectPath, 'symbolic-ref', '-q', 'HEAD'], runOptions)
    if (head.cancelled) {
      return buildCommandResult('merge', head, mapCommandError('merge', head))
    }
    if (head.failed) {
      return buildCommandResult('merge', head, MERGE_PREFLIGHT_ERRORS.DETACHED_HEAD)
    }
    if (await this.#mergeInProgress(projectPath, runOptions)) {
      return buildCommandResult('merge', { ...head, failed: true }, MERGE_PREFLIGHT_ERRORS.MERGE_IN_PROGRESS)
    }
    return null
  }
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/errors.test.js test/adapter.test.js test/merge-real-git.test.js`
Expected: PASS. If the Task 1 FakeRunner tests now fail, they need the `symbolic-ref` mock shown in Task 1 Step 1.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat: a conflicting merge is a state to resolve; refusals in plain language" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Merge state in the working-tree status

**Files:**
- Modify: `src/datalad/status.js` (two pure parsers)
- Modify: `src/datalad/adapter.js` (`getWorkingTreeStatus`, `#readMergeState`)
- Test: `test/status.test.js`, `test/merge-real-git.test.js`

**Interfaces:**
- Consumes: `#mergeInProgress` (Task 2).
- Produces:
  - `parseUnmerged(output: string): Map<string, { 1?: {mode, sha}, 2?: {mode, sha}, 3?: {mode, sha} }>` from `git ls-files -u -z`.
  - `parseMergeBranch(message: string): string | null` from the first line of `MERGE_MSG`.
  - `getWorkingTreeStatus(projectPath)` now also returns `mergeInProgress: boolean`, `mergeBranch: string | null`, and on each conflicted file `sides: { ours: boolean, theirs: boolean }`.

- [ ] **Step 1: Write the failing tests**

Append to `test/status.test.js` (add `parseUnmerged, parseMergeBranch` to its import from `../src/datalad/status.js`):

```js
test('parseUnmerged groups the stages of each conflicted path', () => {
  const out =
    '100644 aaa1 1\tfile.txt\0100644 aaa2 2\tfile.txt\0100644 aaa3 3\tfile.txt\0' +
    '160000 bbb2 2\tsub\0160000 bbb3 3\tsub\0' +
    '100644 ccc1 1\t-odd name.txt\0100644 ccc2 2\t-odd name.txt\0'
  const map = parseUnmerged(out)
  assert.deepEqual([...map.keys()], ['file.txt', 'sub', '-odd name.txt'])
  assert.equal(map.get('file.txt')['3'].sha, 'aaa3')
  assert.equal(map.get('sub')['2'].mode, '160000')
  assert.equal(map.get('-odd name.txt')['3'], undefined)
  assert.equal(parseUnmerged('').size, 0)
})

test('parseMergeBranch reads the other branch from the merge message', () => {
  assert.equal(parseMergeBranch("Merge branch 'feature/x'\n\n# Conflicts:\n#\ta.txt\n"), 'feature/x')
  assert.equal(parseMergeBranch("Merge remote-tracking branch 'origin/main'\n"), 'origin/main')
  assert.equal(parseMergeBranch('something else'), null)
  assert.equal(parseMergeBranch(''), null)
})
```

Append to `test/merge-real-git.test.js`:

```js
test('the status reports an open merge, the other branch and which sides exist', async () => {
  const r = await conflictingRepo()
  await merge(r)
  const status = await r.adapter.getWorkingTreeStatus(r.dir)
  assert.equal(status.mergeInProgress, true)
  assert.equal(status.mergeBranch, 'feature')
  const file = status.files.find((f) => f.path === 'file.txt')
  assert.equal(file.conflicted, true)
  assert.deepEqual(file.sides, { ours: true, theirs: true })
})

test('the status of an ordinary project says no merge is open', async () => {
  const r = await conflictingRepo()
  const status = await r.adapter.getWorkingTreeStatus(r.dir)
  assert.equal(status.mergeInProgress, false)
  assert.equal(status.mergeBranch, null)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/status.test.js test/merge-real-git.test.js`
Expected: FAIL (`parseUnmerged is not a function`, `mergeInProgress` undefined).

- [ ] **Step 3: Implement**

`src/datalad/status.js`, append:

```js
// `git ls-files -u -z`: one "<mode> <sha> <stage>\t<path>" entry per stage of every unmerged path.
// Stage 1 is the common ancestor, 2 this branch, 3 the branch being merged in; a missing stage means that side has no such file.
export function parseUnmerged(output = '') {
  const byPath = new Map()
  for (const entry of output.split('\0')) {
    const tab = entry.indexOf('\t')
    if (tab === -1) {
      continue
    }
    const [mode, sha, stage] = entry.slice(0, tab).split(' ')
    const path = entry.slice(tab + 1)
    byPath.set(path, { ...byPath.get(path), [stage]: { mode, sha } })
  }
  return byPath
}

// First line of .git/MERGE_MSG: "Merge branch 'x'" (merge) or "Merge remote-tracking branch 'origin/x'" (Update).
export function parseMergeBranch(message = '') {
  const match = /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(message.split(/\r?\n/, 1)[0])
  return match ? match[1] : null
}
```

`src/datalad/adapter.js`: import `parseUnmerged, parseMergeBranch` alongside `parseGitStatusPorcelain`. Replace the end of `getWorkingTreeStatus`:

```js
    const merge = await this.#readMergeState(projectPath, parsed.conflictCount)
    const withSides = files.map((file) => {
      const stages = merge.unmerged.get(file.path)
      return file.conflicted && stages ? { ...file, sides: { ours: Boolean(stages['2']), theirs: Boolean(stages['3']) } } : file
    })

    return {
      projectPath,
      ...parsed,
      files: withSides,
      mergeInProgress: merge.mergeInProgress,
      mergeBranch: merge.mergeBranch
    }
```

and add next to `#mergeInProgress`:

```js
  // One extra `rev-parse` per refresh tells whether a merge is open; the rest is read only when it matters.
  async #readMergeState(projectPath, conflictCount) {
    const mergeInProgress = await this.#mergeInProgress(projectPath)
    let mergeBranch = null
    let unmerged = new Map()
    if (mergeInProgress) {
      const where = await this.runner.run('git', ['-C', projectPath, 'rev-parse', '--git-path', 'MERGE_MSG'])
      if (!where.failed) {
        const messagePath = where.stdout.trim()
        const message = await readFile(isAbsolute(messagePath) ? messagePath : join(projectPath, messagePath), 'utf8').catch(() => '')
        mergeBranch = parseMergeBranch(message)
      }
    }
    if (mergeInProgress || conflictCount > 0) {
      const listed = await this.runner.run('git', ['-C', projectPath, 'ls-files', '-u', '-z'])
      if (!listed.failed) {
        unmerged = parseUnmerged(listed.stdout ?? '')
      }
    }
    return { mergeInProgress, mergeBranch, unmerged }
  }
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/status.test.js test/merge-real-git.test.js && npm test 2>&1 | grep -E '^ℹ (pass|fail)'`
Expected: PASS, `fail 0` (other tests that fake the runner for `getWorkingTreeStatus` may need the extra `rev-parse` call to be answered: an unmocked call fails, which means "no merge", so they should still pass).

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat: working-tree status reports an open merge and the sides of each conflict" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Resolve a conflict by picking a side

**Files:**
- Modify: `src/datalad/adapter.js` (`resolveConflict`, helper `hasConflictMarkers`)
- Modify: `src/gui/main.js` (handler `adapter:resolveConflict`)
- Modify: `src/gui/preload.js` (`resolveConflict`)
- Test: `test/merge-real-git.test.js`, `test/trust-wiring.test.js`

**Interfaces:**
- Consumes: `parseUnmerged` (Task 3), `finishMerge`/`abortMerge` (Task 1).
- Produces: `adapter.resolveConflict(projectPath: string, path: string, side: 'ours' | 'theirs' | 'manual')` → `{ ok: true, path, side }`, or throws `Error` with a plain message. Preload: `api.resolveConflict(projectPath, path, side)`. IPC channel `adapter:resolveConflict` (payload `{ projectPath, path, side }`).

- [ ] **Step 1: Write the failing tests**

Append to `test/merge-real-git.test.js`:

```js
const resolve = (r, path, side) => r.adapter.resolveConflict(r.dir, path, side)
const finish = (r) => r.adapter.runCommand('finishMerge', { projectPath: r.dir })

test('keeping this branch\'s version, then finishing, saves the merge with that text', async () => {
  const r = await conflictingRepo()
  await merge(r)
  await resolve(r, 'file.txt', 'ours')
  const done = await finish(r)
  assert.equal(done.ok, true, done.stderr)
  assert.equal(await text(r), 'main\n')
  assert.equal((await r.adapter.getWorkingTreeStatus(r.dir)).mergeInProgress, false)
})

test('keeping the other branch\'s version', async () => {
  const r = await conflictingRepo()
  await merge(r)
  await resolve(r, 'file.txt', 'theirs')
  assert.equal((await finish(r)).ok, true)
  assert.equal(await text(r), 'feature\n')
})

test('a file with spaces and a leading dash resolves like any other', async () => {
  const r = await conflictingRepo('-odd name.txt')
  await merge(r)
  await resolve(r, '-odd name.txt', 'theirs')
  assert.equal((await finish(r)).ok, true)
  assert.equal(await text(r, '-odd name.txt'), 'feature\n')
})

test('finishing with a file still undecided is refused in plain language', async () => {
  const r = await conflictingRepo()
  await merge(r)
  const done = await finish(r)
  assert.equal(done.ok, false)
  assert.equal(done.userError.code, 'MERGE_UNRESOLVED')
})

test('when the other branch deleted the file, keeping its version removes it; keeping ours keeps it', async () => {
  for (const [side, expectFile] of [['theirs', false], ['ours', true]]) {
    const r = await makeRepo()
    await r.write('file.txt', 'base\n')
    await r.write('other.txt', 'o\n')
    r.git('add', '--', '.')
    r.git('commit', '-qm', 'base')
    r.git('checkout', '-qb', 'feature')
    r.git('rm', '-q', '--', 'file.txt')
    r.git('commit', '-qm', 'delete')
    r.git('checkout', '-q', 'main')
    await r.write('file.txt', 'edited on main\n')
    r.git('commit', '-qam', 'edit')
    await merge(r)
    const status = await r.adapter.getWorkingTreeStatus(r.dir)
    assert.deepEqual(status.files.find((f) => f.path === 'file.txt').sides, { ours: true, theirs: false })
    await resolve(r, 'file.txt', side)
    assert.equal((await finish(r)).ok, true)
    assert.equal(r.git('ls-files', '--', 'file.txt').trim() === 'file.txt', expectFile)
  }
})

test('"I fixed it myself" is refused while conflict markers remain, accepted once they are gone', async () => {
  const r = await conflictingRepo()
  await merge(r)
  await assert.rejects(resolve(r, 'file.txt', 'manual'), /conflict markers/)
  await r.write('file.txt', 'combined by hand\n')
  await resolve(r, 'file.txt', 'manual')
  assert.equal((await finish(r)).ok, true)
  assert.equal(await text(r), 'combined by hand\n')
})

test('a Markdown file with a ======= underline is not mistaken for a conflict', async () => {
  const r = await conflictingRepo()
  await merge(r)
  await r.write('file.txt', 'Title\n=======\nbody\n')
  await resolve(r, 'file.txt', 'manual')
})

test('only a file that is in conflict can be resolved, and only with a known side', async () => {
  const r = await conflictingRepo()
  await merge(r)
  await assert.rejects(resolve(r, 'nope.txt', 'ours'), /not in conflict/)
  await assert.rejects(resolve(r, 'file.txt', 'both'), /Invalid side/)
})

test('Cancel Merge puts the project back as it was', async () => {
  const r = await conflictingRepo()
  await merge(r)
  const aborted = await r.adapter.runCommand('abortMerge', { projectPath: r.dir })
  assert.equal(aborted.ok, true, aborted.stderr)
  assert.equal(await text(r), 'main\n')
  assert.equal((await r.adapter.getWorkingTreeStatus(r.dir)).mergeInProgress, false)
})
```

Append to `test/trust-wiring.test.js` (uses its `block` helper):

```js
test('resolving a conflict is only for an authorized project root', () => {
  const body = block("handle('adapter:resolveConflict'")
  assert.match(body, /requireAuthorizedRoot\(payload\.projectPath\)/)
  assert.match(body, /adapter\.resolveConflict\(/)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/merge-real-git.test.js test/trust-wiring.test.js`
Expected: FAIL (`r.adapter.resolveConflict is not a function`, `missing handle('adapter:resolveConflict'`).

- [ ] **Step 3: Implement**

`src/datalad/adapter.js`, module-level (near the other constants):

```js
// "I fixed it myself" looks for leftover markers in text files up to this size; a bigger file is taken at its word.
const MAX_MARKER_SCAN_BYTES = 10 * 1024 * 1024
async function hasConflictMarkers(file) {
  const info = await lstat(file).catch(() => null)
  if (!info?.isFile() || info.size > MAX_MARKER_SCAN_BYTES) {
    return false
  }
  const content = await readFile(file, 'utf8')
  // Both ends: a lone ======= is an ordinary Markdown heading underline.
  return /^<{7}( |$)/m.test(content) && /^>{7}( |$)/m.test(content)
}
```

Method on `DataLadAdapter` (next to `untrackPath`):

```js
  // One file of an open merge: keep this branch's version, the other branch's, or accept what the researcher edited.
  // A path is only acted on when git lists it as unmerged, so it can never point outside the project.
  async resolveConflict(projectPath, path, side) {
    await this.#ensureGitProject(projectPath)
    if (!['ours', 'theirs', 'manual'].includes(side)) {
      throw new Error(`Invalid side: ${side}`)
    }
    if (typeof path !== 'string' || !path.trim()) {
      throw new Error('Choose a file first.')
    }
    const git = async (...args) => {
      const result = await this.runner.run('git', ['-C', projectPath, ...args])
      if (result.failed) {
        throw new Error(`Could not resolve ${path}: ${(result.stderr || result.stdout || 'unknown error').trim()}`)
      }
      return result
    }

    const stages = parseUnmerged((await git('ls-files', '-u', '-z')).stdout ?? '').get(path)
    if (!stages) {
      throw new Error(`${path} is not in conflict.`)
    }

    if (side === 'manual') {
      if (await hasConflictMarkers(join(projectPath, path))) {
        throw new Error(`${path} still contains conflict markers (<<<<<<< and >>>>>>>). Edit the file, then try again.`)
      }
      await git('add', '-A', '--', path)
      return { ok: true, path, side }
    }

    const chosen = stages[side === 'ours' ? '2' : '3']
    if (!chosen) {
      await git('rm', '-q', '-f', '--', path) // that side deleted the file
    } else if (chosen.mode === '160000') {
      await git('update-index', '--cacheinfo', `160000,${chosen.sha},${path}`) // a subdataset: record that side's commit
    } else {
      await git('checkout', `--${side}`, '--', path)
      await git('add', '--', path)
    }
    return { ok: true, path, side }
  }
```

`src/gui/main.js`, after the `adapter:untrackPath` handler:

```js
handle('adapter:resolveConflict', async (_event, payload = {}) => {
  requireAuthorizedRoot(payload.projectPath)
  return adapter.resolveConflict(payload.projectPath, payload.path, payload.side)
})
```

`src/gui/preload.js`, after `untrackPath`:

```js
  resolveConflict: (projectPath, path, side) =>
    ipcRenderer.invoke('adapter:resolveConflict', { projectPath, path, side }),
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/merge-real-git.test.js test/trust-wiring.test.js && npm test 2>&1 | grep -E '^ℹ (pass|fail)'`
Expected: PASS, `fail 0`. (If the `-odd name.txt` test fails inside git, read the error: every path argument must come after `--`.)

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat: resolve a conflicting file by picking a side" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Keep subdatasets in step after a merge

**Files:**
- Modify: `src/datalad/adapter.js` (`syncSubdatasets`; call from `runCommand`)
- Test: `test/merge-real-git.test.js`

**Interfaces:**
- Consumes: `isSafeRelativeSubdatasetPath` (already in `adapter.js`), the Task 2 `runCommand` tail.
- Produces: `adapter.syncSubdatasets(projectPath, depth = 0)` → `Promise<Array<{ code: 'SUBDATASET_NOT_MOVED', severity: 'warning', message: string }>>`. `runCommand('merge' | 'finishMerge')` appends these to `result.warnings` when it succeeds.

- [ ] **Step 1: Write the failing tests**

Append to `test/merge-real-git.test.js`:

```js
// A parent project with one submodule "sub" whose checkout has its own identity configured.
async function repoWithSub() {
  const origin = await makeRepo()
  await origin.write('s.txt', '1\n')
  origin.git('add', '--', '.')
  origin.git('commit', '-qm', 's1')
  const r = await makeRepo()
  await r.write('a.txt', 'a\n')
  r.git('add', '--', '.')
  r.git('commit', '-qm', 'base')
  r.git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', origin.dir, 'sub')
  r.git('commit', '-qm', 'add sub')
  r.git('-C', 'sub', 'config', 'user.email', 'ana@example.org')
  r.git('-C', 'sub', 'config', 'user.name', 'Ana')
  r.git('-C', 'sub', 'config', 'commit.gpgsign', 'false')
  const subHead = () => r.git('-C', 'sub', 'rev-parse', 'HEAD').trim()
  return { r, subHead, c1: subHead() }
}

// The parent records a newer subdataset commit than the one checked out (what a merge leaves behind).
async function parentRecordsNewerSub({ dirtySub = false } = {}) {
  const { r, subHead, c1 } = await repoWithSub()
  await writeFile(join(r.dir, 'sub', 's.txt'), '2\n')
  r.git('-C', 'sub', 'commit', '-qam', 's2')
  const c2 = subHead()
  r.git('add', '--', 'sub')
  r.git('commit', '-qm', 'record s2')
  r.git('-C', 'sub', 'checkout', '-q', '--detach', c1)
  if (dirtySub) {
    await writeFile(join(r.dir, 'sub', 's.txt'), 'unsaved work\n')
  }
  return { r, subHead, c1, c2 }
}

test('a subdataset checkout is moved to the commit the merge recorded', async () => {
  const { r, subHead, c2 } = await parentRecordsNewerSub()
  const warnings = await r.adapter.syncSubdatasets(r.dir)
  assert.deepEqual(warnings, [])
  assert.equal(subHead(), c2)
})

test('a subdataset with unsaved work is left alone and the researcher is told', async () => {
  const { r, subHead, c1 } = await parentRecordsNewerSub({ dirtySub: true })
  const warnings = await r.adapter.syncSubdatasets(r.dir)
  assert.equal(subHead(), c1)
  assert.equal(await readFile(join(r.dir, 'sub', 's.txt'), 'utf8'), 'unsaved work\n')
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0].code, 'SUBDATASET_NOT_MOVED')
  assert.match(warnings[0].message, /sub/)
})

test('a subdataset whose recorded commit is not a fast-forward is left alone', async () => {
  const { r, subHead, c1 } = await repoWithSub()
  await writeFile(join(r.dir, 'sub', 's.txt'), 'mine\n')
  r.git('-C', 'sub', 'commit', '-qam', 'my own commit')
  const mine = subHead()
  r.git('-C', 'sub', 'checkout', '-q', '--detach', c1)
  await writeFile(join(r.dir, 'sub', 's.txt'), 'theirs\n')
  r.git('-C', 'sub', 'commit', '-qam', 'diverging commit')
  r.git('add', '--', 'sub')
  r.git('commit', '-qm', 'record diverging commit')
  r.git('-C', 'sub', 'checkout', '-q', '--detach', mine)
  const warnings = await r.adapter.syncSubdatasets(r.dir)
  assert.equal(subHead(), mine)
  assert.equal(warnings[0]?.code, 'SUBDATASET_NOT_MOVED')
})

test('finishing a merge that brings a newer subdataset commit moves the checkout', async () => {
  const { r, subHead, c1 } = await repoWithSub()
  r.git('checkout', '-qb', 'feature')
  await writeFile(join(r.dir, 'sub', 's.txt'), '2\n')
  r.git('-C', 'sub', 'commit', '-qam', 's2')
  const c2 = subHead()
  r.git('add', '--', 'sub')
  r.git('commit', '-qm', 'bump sub')
  r.git('checkout', '-q', 'main')
  r.git('-C', 'sub', 'checkout', '-q', '--detach', c1)
  await r.write('a.txt', 'a2\n')
  r.git('commit', '-qam', 'main edit')

  const result = await merge(r)
  assert.equal(result.ok, true, result.stderr)
  assert.equal(subHead(), c2)
})

test('a subdataset conflict is resolved by recording the chosen commit', async () => {
  const { r, subHead, c1 } = await repoWithSub()
  r.git('checkout', '-qb', 'feature')
  await writeFile(join(r.dir, 'sub', 's.txt'), 'feature side\n')
  r.git('-C', 'sub', 'commit', '-qam', 'feature sub')
  const theirs = subHead()
  r.git('add', '--', 'sub')
  r.git('commit', '-qm', 'feature bumps sub')
  r.git('checkout', '-q', 'main')
  r.git('-C', 'sub', 'checkout', '-q', '--detach', c1)
  await writeFile(join(r.dir, 'sub', 's.txt'), 'main side\n')
  r.git('-C', 'sub', 'commit', '-qam', 'main sub')
  r.git('add', '--', 'sub')
  r.git('commit', '-qm', 'main bumps sub')

  const started = await merge(r)
  assert.equal(started.conflicts, true)
  const status = await r.adapter.getWorkingTreeStatus(r.dir)
  assert.deepEqual(status.files.find((f) => f.path === 'sub').sides, { ours: true, theirs: true })
  await r.adapter.resolveConflict(r.dir, 'sub', 'theirs')
  const done = await r.adapter.runCommand('finishMerge', { projectPath: r.dir })
  assert.equal(done.ok, true, done.stderr)
  assert.equal(r.git('ls-tree', 'HEAD', '--', 'sub').split(/\s+/)[2], theirs)
  assert.equal(done.warnings[0]?.code, 'SUBDATASET_NOT_MOVED') // the checkout holds this branch's own commit
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/merge-real-git.test.js`
Expected: FAIL (`r.adapter.syncSubdatasets is not a function`).

- [ ] **Step 3: Implement**

`src/datalad/adapter.js`, module-level constant `const MAX_SUBDATASET_DEPTH = 8 // symlinked or hostile nesting cannot recurse forever`, and the method (next to `resolveConflict`):

```js
  // A merge records the other branch's subdataset commits but leaves each checkout where it was; a later Save would
  // record the old checkout again and undo the merge. Move each installed subdataset forward when that is a plain
  // fast-forward of a clean checkout, and say so when it is not. Local only; nothing is fetched.
  async syncSubdatasets(projectPath, depth = 0) {
    const warnings = []
    if (depth > MAX_SUBDATASET_DEPTH) {
      return warnings
    }
    const status = await this.runner.run('git', ['-C', projectPath, 'submodule', 'status'])
    if (status.failed) {
      return warnings
    }
    for (const line of (status.stdout ?? '').split(/\r?\n/)) {
      const match = /^\+([0-9a-f]{40,64}) (.+?)(?: \([^)]*\))?$/.exec(line) // "+": checked out commit differs from the recorded one
      if (!match || !isSafeRelativeSubdatasetPath(match[2])) {
        continue
      }
      const relative = match[2]
      const sub = join(projectPath, relative)
      const recorded = await this.runner.run('git', ['-C', projectPath, 'rev-parse', `HEAD:${relative}`])
      const dirty = await this.runner.run('git', ['-C', sub, 'status', '--porcelain', '--untracked-files=no'])
      const moved =
        !recorded.failed &&
        !dirty.failed &&
        !dirty.stdout.trim() &&
        !(await this.runner.run('git', ['-C', sub, 'merge', '--ff-only', recorded.stdout.trim()])).failed
      if (moved) {
        warnings.push(...(await this.syncSubdatasets(sub, depth + 1)))
      } else {
        warnings.push({
          code: 'SUBDATASET_NOT_MOVED',
          severity: 'warning',
          message: `Subdataset ${relative} has its own changes; it was not moved to the merged version.`
        })
      }
    }
    return warnings
  }
```

In `runCommand`, change the success branch from Task 2 to:

```js
    if (!result.failed) {
      if (commandName === 'merge' || commandName === 'finishMerge') {
        warnings.push(...(await this.syncSubdatasets(request.projectPath)))
      }
      return buildCommandResult(commandName, result, null, warnings)
    }
```

(`warnings` is declared with `const` as an array, so `push` is fine. A merge that stopped on conflicts returns earlier and is not synced; `finishMerge` syncs.)

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/merge-real-git.test.js && npm test 2>&1 | grep -E '^ℹ (pass|fail)'`
Expected: PASS. If git itself refuses the merge in "finishing a merge that brings a newer subdataset commit…" (read `result.stderr`), keep the direct `syncSubdatasets` tests, and change that one test to assert git's refusal is mapped to `WORKTREE_DIRTY`; do not weaken the direct tests.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat: subdatasets follow a merge when that is a safe fast-forward" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Annexed-file conflict against real DataLad

**Files:**
- Test: `test/merge-real-git.test.js` (test only; no production change expected)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the test**

Append to `test/merge-real-git.test.js` (add `const hasDatalad = …` the same way `test/process-runner.test.js:466` does, and import `symlink`-free helpers only):

```js
const hasDatalad = (() => { try { execFileSync('datalad', ['--version'], { stdio: 'ignore' }); return true } catch { return false } })()

test('a conflict on an annexed file is resolved by picking a side', { skip: (!hasDatalad || process.platform === 'win32') && 'needs datalad on POSIX' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dlad-merge-annex-'))
  const sh = (cmd, ...args) => execFileSync(cmd, args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
  sh('datalad', 'create', '-q', '--', '.')
  await writeFile(join(dir, 'big.bin'), 'base'.repeat(100))
  sh('datalad', 'save', '-m', 'base')
  sh('git', 'checkout', '-qb', 'feature')
  await writeFile(join(dir, 'big.bin'), 'feature'.repeat(100))
  sh('datalad', 'save', '-m', 'feature')
  sh('git', 'checkout', '-q', 'main')
  await writeFile(join(dir, 'big.bin'), 'main'.repeat(100))
  sh('datalad', 'save', '-m', 'main')

  const adapter = new DataLadAdapter({ runner: new ProcessRunner() })
  const started = await adapter.runCommand('merge', { projectPath: dir, branchName: 'feature' })
  assert.equal(started.conflicts, true, started.stderr)
  await adapter.resolveConflict(dir, 'big.bin', 'theirs')
  const done = await adapter.runCommand('finishMerge', { projectPath: dir })
  assert.equal(done.ok, true, done.stderr)
  assert.equal(await readFile(join(dir, 'big.bin'), 'utf8'), 'feature'.repeat(100))
})
```

- [ ] **Step 2: Run it**

Run: `node --test test/merge-real-git.test.js`
Expected: PASS where datalad is installed; reported as skipped otherwise. A failure here is a real finding about annexed files: read the output, fix `resolveConflict`, and keep the test (do not skip it to pass).

- [ ] **Step 3: Commit**

```bash
git add test
git commit -m "test: an annexed-file conflict is resolved against real DataLad" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Renderer logic (pure module) and Save gating

**Files:**
- Create: `src/gui/renderer/merge-ui.js`
- Modify: `src/gui/renderer/save-gating.js`
- Test: Create `test/merge-ui.test.js`; modify `test/save-gating.test.js`

**Interfaces:**
- Produces from `merge-ui.js`:
  - `mergeCandidates(branches: string[], currentBranch: string | null): string[]`
  - `mergeBlockReason({ branchName, currentBranch, detachedHead, snapshot }): string | null`
  - `mergeBannerModel(snapshot, currentBranch): { visible: false } | { visible: true, title, summary, canFinish: boolean, conflicts: Array<{ path, oursLabel, theirsLabel }> }`
- `computeSaveGating` gains an input `mergeInProgress` (boolean, default false); when true it returns `{ disabled: true, guidance: { text: 'A merge is in progress. Finish or cancel it first.', warning: true } }` before any other rule.

- [ ] **Step 1: Write the failing tests**

Create `test/merge-ui.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeBannerModel, mergeBlockReason, mergeCandidates } from '../src/gui/renderer/merge-ui.js'

const clean = { stagedCount: 0, unstagedCount: 0, untrackedCount: 2, mergeInProgress: false, files: [] }

test('the picker offers every local branch except the current one', () => {
  assert.deepEqual(mergeCandidates(['feature', 'main', 'x'], 'main'), ['feature', 'x'])
  assert.deepEqual(mergeCandidates([], null), [])
})

test('merging is blocked with a plain reason, first matching rule wins', () => {
  const ok = { branchName: 'feature', currentBranch: 'main', detachedHead: false, snapshot: clean }
  assert.equal(mergeBlockReason(ok), null)
  assert.equal(mergeBlockReason({ ...ok, detachedHead: true }), 'Switch to a branch before merging.')
  assert.equal(mergeBlockReason({ ...ok, currentBranch: null }), 'Switch to a branch before merging.')
  assert.equal(mergeBlockReason({ ...ok, branchName: '' }), 'Pick the branch to merge in first.')
  assert.equal(mergeBlockReason({ ...ok, snapshot: { ...clean, mergeInProgress: true } }), 'Finish or cancel the current merge first.')
  assert.equal(mergeBlockReason({ ...ok, snapshot: { ...clean, stagedCount: 1 } }), 'Save your changes first, then merge.')
  assert.equal(mergeBlockReason({ ...ok, snapshot: { ...clean, unstagedCount: 1 } }), 'Save your changes first, then merge.')
})

test('untracked files alone do not block a merge', () => {
  assert.equal(mergeBlockReason({ branchName: 'f', currentBranch: 'main', detachedHead: false, snapshot: clean }), null)
})

test('there is no banner unless a merge is open', () => {
  assert.deepEqual(mergeBannerModel(clean, 'main'), { visible: false })
  assert.deepEqual(mergeBannerModel(null, 'main'), { visible: false })
})

test('the banner names both branches, counts the files to decide and labels each choice', () => {
  const snapshot = {
    mergeInProgress: true,
    mergeBranch: 'feature',
    files: [
      { path: 'a.txt', conflicted: true, sides: { ours: true, theirs: true } },
      { path: 'gone.txt', conflicted: true, sides: { ours: true, theirs: false } },
      { path: 'fine.txt', conflicted: false }
    ]
  }
  const model = mergeBannerModel(snapshot, 'main')
  assert.equal(model.visible, true)
  assert.equal(model.title, 'Merging feature into main')
  assert.equal(model.summary, '2 files to decide')
  assert.equal(model.canFinish, false)
  assert.deepEqual(model.conflicts[0], { path: 'a.txt', oursLabel: "Keep this branch's version", theirsLabel: "Keep feature's version" })
  assert.equal(model.conflicts[1].theirsLabel, 'Keep it deleted')
  assert.equal(model.conflicts.length, 2)
})

test('with nothing left to decide the merge can be finished', () => {
  const model = mergeBannerModel({ mergeInProgress: true, mergeBranch: null, files: [] }, 'main')
  assert.equal(model.canFinish, true)
  assert.equal(model.summary, 'Everything is decided. Finish the merge to save it.')
  assert.equal(model.title, 'Merging the other branch into main')
})

test('one file reads as singular', () => {
  const model = mergeBannerModel({ mergeInProgress: true, mergeBranch: 'x', files: [{ path: 'a', conflicted: true, sides: { ours: true, theirs: true } }] }, 'main')
  assert.equal(model.summary, '1 file to decide')
})
```

Append to `test/save-gating.test.js` (it imports `computeSaveGating`):

```js
test('Save is disabled while a merge is open, whatever else is true', () => {
  const gating = computeSaveGating({ hasMessage: true, hasSelection: true, hasConflicts: false, hasChanges: true, mergeInProgress: true })
  assert.equal(gating.disabled, true)
  assert.equal(gating.guidance.text, 'A merge is in progress. Finish or cancel it first.')
  assert.equal(computeSaveGating({ hasMessage: true, hasSelection: true, hasConflicts: false, hasChanges: true }).disabled, false)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/merge-ui.test.js test/save-gating.test.js`
Expected: FAIL (module not found; `disabled` false).

- [ ] **Step 3: Implement**

Create `src/gui/renderer/merge-ui.js`:

```js
// Pure logic behind the Merge controls and the merge banner. DOM wiring is in app.js.

export function mergeCandidates(branches, currentBranch) {
  return branches.filter((branch) => branch !== currentBranch)
}

// Why a merge cannot start right now, in researcher language, or null. Untracked files do not count: git itself
// refuses (and names them) only when one would be overwritten.
export function mergeBlockReason({ branchName, currentBranch, detachedHead, snapshot }) {
  if (detachedHead || !currentBranch) {
    return 'Switch to a branch before merging.'
  }
  if (!branchName) {
    return 'Pick the branch to merge in first.'
  }
  if (snapshot?.mergeInProgress) {
    return 'Finish or cancel the current merge first.'
  }
  if (snapshot && snapshot.stagedCount + snapshot.unstagedCount > 0) {
    return 'Save your changes first, then merge.'
  }
  return null
}

export function mergeBannerModel(snapshot, currentBranch) {
  if (!snapshot?.mergeInProgress) {
    return { visible: false }
  }
  const other = snapshot.mergeBranch ?? 'the other branch'
  const conflicted = (snapshot.files ?? []).filter((file) => file.conflicted)
  return {
    visible: true,
    title: `Merging ${snapshot.mergeBranch ?? 'the other branch'} into ${currentBranch ?? 'this branch'}`,
    summary:
      conflicted.length === 0
        ? 'Everything is decided. Finish the merge to save it.'
        : `${conflicted.length} file${conflicted.length === 1 ? '' : 's'} to decide`,
    canFinish: conflicted.length === 0,
    conflicts: conflicted.map((file) => ({
      path: file.path,
      oursLabel: file.sides?.ours === false ? 'Keep it deleted' : "Keep this branch's version",
      theirsLabel: file.sides?.theirs === false ? 'Keep it deleted' : `Keep ${other}'s version`
    }))
  }
}
```

`src/gui/renderer/save-gating.js`: add `mergeInProgress = false,` to the destructured inputs of `computeSaveGating` (and a line to its JSDoc), and as the first statement:

```js
  if (mergeInProgress) {
    return {
      disabled: true,
      guidance: { text: 'A merge is in progress. Finish or cancel it first.', warning: true }
    }
  }
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/merge-ui.test.js test/save-gating.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat: merge banner and block rules as a pure renderer module" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Wire the Merge controls and banner into the app

**Files:**
- Modify: `src/gui/renderer/index.html` (Branch section; banner above "Files To Save")
- Modify: `src/gui/renderer/app.js`
- Create: `test/merge-wiring.test.js`
- Create: `e2e/merge.e2e.mjs`

**Interfaces:**
- Consumes: `mergeCandidates`, `mergeBlockReason`, `mergeBannerModel`, `computeSaveGating({ mergeInProgress })`, `api.resolveConflict`, `runWorkflowCommand('merge' | 'finishMerge' | 'abortMerge', …)`, `refreshWorkingTreeStatus(projectPath)` (returns the snapshot), `refreshBranchList(projectPath)`.

- [ ] **Step 1: Write the failing wiring test**

Create `test/merge-wiring.test.js` (app.js is a DOM script, so its wiring is pinned by reading it, like `test/trust-wiring.test.js`):

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const html = read('../src/gui/renderer/index.html')
const app = read('../src/gui/renderer/app.js')
const preload = read('../src/gui/preload.js')

test('every merge control in the page is looked up by app.js', () => {
  for (const id of ['merge-branch-select', 'merge-branch', 'merge-banner', 'merge-banner-title', 'merge-summary', 'merge-conflict-list', 'merge-cancel', 'merge-finish']) {
    assert.match(html, new RegExp(`id="${id}"`), `index.html lacks #${id}`)
    assert.match(app, new RegExp(`getElementById\\('${id}'\\)`), `app.js never looks up #${id}`)
  }
})

test('the page labels the controls the way the tutorials name them', () => {
  assert.match(html, /Merge Into Current Branch/)
  assert.match(html, />\s*Cancel Merge\s*</)
  assert.match(html, />\s*Finish Merge\s*</)
})

test('the renderer runs the three merge commands and the per-file resolution', () => {
  for (const command of ['merge', 'finishMerge', 'abortMerge']) {
    assert.match(app, new RegExp(`runWorkflowCommand\\('${command}'`), `${command} is never started`)
    assert.match(app, new RegExp(`commandName === '${command}'`), `${command} has no action label`)
  }
  assert.match(app, /api\.resolveConflict\(/)
  assert.match(preload, /resolveConflict:/)
})

test('an open merge blocks branch actions and Save', () => {
  const guard = app.slice(app.indexOf('async function ensureBranchActionSafety'))
  assert.match(guard.slice(0, 600), /snapshot\.mergeInProgress/)
  assert.match(app, /mergeInProgress: Boolean\(snapshot\?\.mergeInProgress\)/)
  assert.match(app, /saveProjectButton\.hidden = Boolean\(snapshot\?\.mergeInProgress\)/)
})

test('conflict buttons use data attributes and one delegated listener (no inline handlers: CSP)', () => {
  assert.match(app, /data-side=/)
  assert.match(app, /mergeConflictList\.addEventListener\('click'/)
  assert.doesNotMatch(app, /onclick=/)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/merge-wiring.test.js`
Expected: FAIL (no such ids, no commands in app.js).

- [ ] **Step 3: Implement**

`src/gui/renderer/index.html`. In the Branch section, after the "New Branch Name" `<label class="field">…</label>` and before `<p id="branch-status"`:

```html
            <label class="field">
              <span>Merge Into Current Branch</span>
              <div class="field-row">
                <select id="merge-branch-select"></select>
                <button id="merge-branch" class="button button-ghost button-inline" type="button">Merge</button>
              </div>
            </label>
```

Immediately before the `<section class="status-box" aria-labelledby="changed-files-title">` ("Files To Save"):

```html
          <section id="merge-banner" class="status-box" aria-labelledby="merge-banner-title" hidden>
            <div class="section-head branch-head">
              <h3 id="merge-banner-title">Merge in progress</h3>
              <div class="section-actions">
                <button id="merge-cancel" class="button button-ghost button-inline" type="button">Cancel Merge</button>
                <button id="merge-finish" class="button button-primary button-inline" type="button">Finish Merge</button>
              </div>
            </div>
            <p id="merge-summary" class="lede-small"></p>
            <ul id="merge-conflict-list" class="changed-files-list"></ul>
          </section>
```

`src/gui/renderer/app.js`:

1. Import (next to the `save-gating.js` import): `import { mergeBannerModel, mergeBlockReason, mergeCandidates } from './merge-ui.js'`.
2. In the `elements` object (next to `switchBranchButton`):

```js
  mergeBranchSelect: document.getElementById('merge-branch-select'),
  mergeBranchButton: document.getElementById('merge-branch'),
  mergeBanner: document.getElementById('merge-banner'),
  mergeBannerTitle: document.getElementById('merge-banner-title'),
  mergeSummary: document.getElementById('merge-summary'),
  mergeConflictList: document.getElementById('merge-conflict-list'),
  mergeCancelButton: document.getElementById('merge-cancel'),
  mergeFinishButton: document.getElementById('merge-finish'),
```

3. In the `state` object add `currentBranch: null, detachedHead: false, localBranches: [],` (keep the object's existing style).
4. In `refreshBranchList`, after `const branchNames = …`: store them and fill the picker:

```js
    state.currentBranch = branchSnapshot.currentBranch || null
    state.detachedHead = Boolean(branchSnapshot.detachedHead)
    state.localBranches = branchNames
    renderMergeBranchSelect()
```

   and in its `!projectPath` early return add `state.currentBranch = null; state.localBranches = []; renderMergeBranchSelect()`.

5. New functions (place near `ensureBranchActionSafety`):

```js
function renderMergeBranchSelect() {
  const candidates = mergeCandidates(state.localBranches, state.currentBranch)
  elements.mergeBranchSelect.innerHTML = candidates.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')
  elements.mergeBranchButton.disabled = candidates.length === 0
}

function renderMergeBanner() {
  const model = mergeBannerModel(state.workingTreeSnapshot, state.currentBranch)
  elements.mergeBanner.hidden = !model.visible
  if (!model.visible) {
    return
  }
  elements.mergeBannerTitle.textContent = model.title
  elements.mergeSummary.textContent = model.summary
  elements.mergeFinishButton.disabled = !model.canFinish
  elements.mergeConflictList.innerHTML = model.conflicts
    .map(
      (file) =>
        `<li><span>${escapeHtml(file.path)}</span> ` +
        `<button type="button" class="button button-ghost button-inline" data-side="ours" data-path="${escapeHtml(file.path)}">${escapeHtml(file.oursLabel)}</button> ` +
        `<button type="button" class="button button-ghost button-inline" data-side="theirs" data-path="${escapeHtml(file.path)}">${escapeHtml(file.theirsLabel)}</button> ` +
        `<button type="button" class="button button-ghost button-inline" data-side="manual" data-path="${escapeHtml(file.path)}">I fixed it myself</button></li>`
    )
    .join('')
}
```

   `escapeHtml` must escape quotes (it is the repo's one escaping routine; confirm it handles `"` before relying on it in an attribute, and if it does not, add the quote case with a test in `test/escape-html.test.js` first).

6. Call `renderMergeBanner()` in the place that stores a new snapshot (search `state.workingTreeSnapshot =`; call it right after the assignment, in each place) and at the end of `renderMergeBranchSelect`'s callers is not needed.
7. Handlers (next to the `createBranchButton` listener):

```js
elements.mergeBranchButton.addEventListener('click', async () => {
  const projectPath = readProjectPath()
  if (!projectPath) {
    return
  }
  const branchName = elements.mergeBranchSelect.value.trim()
  const snapshot = await refreshWorkingTreeStatus(projectPath)
  const blocked = mergeBlockReason({ branchName, currentBranch: state.currentBranch, detachedHead: state.detachedHead, snapshot })
  if (blocked) {
    setBranchStatus(blocked, 'error')
    setLastActionState(blocked, 'error')
    return
  }
  const result = await runWorkflowCommand('merge', { projectPath, branchName }, elements.mergeBranchButton)
  if (!result?.ok) {
    return
  }
  if (result.conflicts) {
    setBranchStatus('Merge stopped: some files changed on both branches. Decide each one in the list above Files To Save.', 'error')
  } else if (/already up to date/i.test(result.stdout ?? '')) {
    setBranchStatus(`Nothing to merge: this branch already has everything from ${branchName}.`, 'idle')
  } else {
    setBranchStatus(`Merged ${branchName} into ${state.currentBranch}.`, 'success')
  }
  await refreshBranchList(projectPath)
})

elements.mergeConflictList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-side]')
  const projectPath = readProjectPath()
  if (!button || !projectPath) {
    return
  }
  button.disabled = true
  try {
    await api.resolveConflict(projectPath, button.dataset.path, button.dataset.side)
  } catch (error) {
    elements.commandOutput.textContent = String(error.message)
    setLastActionState('Could not resolve that file.', 'error')
  } finally {
    await refreshWorkingTreeStatus(projectPath)
  }
})

elements.mergeFinishButton.addEventListener('click', async () => {
  const projectPath = readProjectPath()
  if (projectPath) {
    await runWorkflowCommand('finishMerge', { projectPath }, elements.mergeFinishButton)
  }
})

elements.mergeCancelButton.addEventListener('click', async () => {
  const projectPath = readProjectPath()
  if (!projectPath || !window.confirm('Cancel the merge? Everything goes back to how it was before you started.')) {
    return
  }
  await runWorkflowCommand('abortMerge', { projectPath }, elements.mergeCancelButton)
})
```

8. `actionLabel`: add `if (commandName === 'merge') { return 'Merge' }`, `'finishMerge'` → `'Finish Merge'`, `'abortMerge'` → `'Cancel Merge'`.
9. `ensureBranchActionSafety`: directly after the `!snapshot` check, before the `conflictCount` check:

```js
  if (snapshot.mergeInProgress) {
    setBranchStatus('Finish or cancel the current merge first.', 'error')
    setLastActionState('Finish or cancel the current merge first.', 'error')
    return false
  }
```

10. `updateSaveButtonState`: add `mergeInProgress: Boolean(snapshot?.mergeInProgress),` to the `computeSaveGating({…})` call, and after `elements.saveProjectButton.disabled = gating.disabled` add `elements.saveProjectButton.hidden = Boolean(snapshot?.mergeInProgress)`.

- [ ] **Step 4: Run to verify the wiring test passes**

Run: `node --test test/merge-wiring.test.js && npm test 2>&1 | grep -E '^ℹ (pass|fail)'`
Expected: PASS, `fail 0` (the CSP test must stay green: it forbids inline scripts and handlers).

- [ ] **Step 5: Write the e2e flow (red first: it fails until the app behaves)**

Create `e2e/merge.e2e.mjs`. Plain git is enough (no DataLad needed). Run it with the Electron env var unset (project memory: `ELECTRON_RUN_AS_NODE` breaks launching Electron).

```js
// Drives the real app: two branches change the same file, Merge stops, the researcher picks a version, Finish Merge.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'

let app
let projectPath
const git = (...args) => execFileSync('git', args, { cwd: projectPath, encoding: 'utf8' })
const statusLine = (pattern) =>
  app.page.waitForFunction(
    (source) => new RegExp(source).test(document.getElementById('last-action-state')?.textContent ?? ''),
    pattern.source,
    { timeout: 60_000 }
  )

test.before(async () => {
  projectPath = await mkdtemp(join(tmpdir(), 'dlad-e2e-merge-'))
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'ana@example.org')
  git('config', 'user.name', 'Ana')
  await writeFile(join(projectPath, 'file.txt'), 'base\n')
  git('add', '--', '.')
  git('commit', '-qm', 'base')
  git('checkout', '-qb', 'feature')
  await writeFile(join(projectPath, 'file.txt'), 'feature\n')
  git('commit', '-qam', 'feature edit')
  git('checkout', '-q', 'main')
  await writeFile(join(projectPath, 'file.txt'), 'main\n')
  git('commit', '-qam', 'main edit')
  app = await launchApp({ trustedPaths: [projectPath] })
  await app.openProject(projectPath)
})

test.after(async () => {
  await app?.close()
})

test('a conflicting merge stops, the researcher picks a version, Finish Merge saves it', async () => {
  await app.page.waitForFunction(() => document.querySelector('#merge-branch-select option[value="feature"]'), null, { timeout: 60_000 })
  await app.page.evaluate(() => {
    document.getElementById('merge-branch-select').value = 'feature'
    document.getElementById('merge-branch').click()
  })
  await statusLine(/Merge completed/)
  await app.page.waitForFunction(() => !document.getElementById('merge-banner').hidden, null, { timeout: 60_000 })
  assert.match(await app.page.evaluate(() => document.getElementById('merge-summary').textContent), /1 file to decide/)
  assert.equal(await app.page.evaluate(() => document.getElementById('merge-finish').disabled), true)

  await app.page.evaluate(() => document.querySelector('#merge-conflict-list button[data-side="theirs"]').click())
  await app.page.waitForFunction(() => !document.getElementById('merge-finish').disabled, null, { timeout: 60_000 })
  await app.page.evaluate(() => document.getElementById('merge-finish').click())
  await statusLine(/Finish Merge completed/)

  assert.equal(await readFile(join(projectPath, 'file.txt'), 'utf8'), 'feature\n')
  assert.match(git('log', '-1', '--format=%s'), /^Merge branch 'feature'/)
  await app.page.waitForFunction(() => document.getElementById('merge-banner').hidden, null, { timeout: 60_000 })
})
```

Run: `env -u ELECTRON_RUN_AS_NODE node --test e2e/merge.e2e.mjs`
Expected: PASS. If a wait times out, read `#command-output` and `#last-action-state` in the failure message before changing anything.

- [ ] **Step 6: Commit**

```bash
git add src test e2e
git commit -m "feat: Merge Into Current Branch, the merge banner and per-file choices" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Documentation, tutorials and release notes

**Files:**
- Modify: `docs/tutorials/03-team-feature-branches.md`, `04-multimodal-project.md`, `05-longitudinal-multisite.md`, `06-publication-freeze-release.md`
- Modify: `README.md`, `CHANGELOG.md`, `SECURITY.md`
- Modify: `docs/product/researcher-workflow.md`, `docs/architecture/datalad-adapter-interface.md`
- Modify: `docs/superpowers/specs/2026-10-06-merge-branches-design.md`

- [ ] **Step 1: Rewrite the merge steps in tutorials 03–06**

Read each file. Wherever a step says "Merge `X` into `Y`" (03 lines ~41-43, 04 line ~40, 05 lines ~39-48, 06 line ~45) replace it with the real flow, for example for 03:

```markdown
4. In **Project Setup → Branch**, switch to `main`, choose `feature/preprocessing` under **Merge Into Current Branch** and click **Merge**.
5. Repeat for `feature/statistics`, then `feature/figures`.
```

Where a tutorial's failure injection triggers a conflict, describe the real recovery: the **Merge in progress** banner appears above **Files To Save**; for each file choose **Keep this branch's version**, **Keep `<branch>`'s version** or edit the file yourself and choose **I fixed it myself**; then **Finish Merge** (or **Cancel Merge** to go back). In 06, the release freeze step should also use **Mark As Version** in Time Machine for the submitted state. Prerequisite line for each affected tutorial: *save all changes first; Merge refuses to start with unsaved changes.*

Verify: `grep -c "Merge Into Current Branch" docs/tutorials/0[3-6]*.md` shows at least 1 for each file, and `grep -n "git merge\|terminal" docs/tutorials/0[3-6]*.md` shows no instruction to merge outside the app.

- [ ] **Step 2: README, CHANGELOG, SECURITY, workflow and interface docs**

- `README.md`, "Why use it?" list, after the "Branch when you need to" bullet: `- **Bring branches together** — merge a branch into the one you are on; if the same file changed on both, pick a version per file and finish (or cancel) the merge.`
- `CHANGELOG.md`, new `### Merge branches` subsection in 0.5.0 (before `### Science workflow`): Merge Into Current Branch in Project Setup (local branches, needs saved changes, fast-forward or merge commit); conflicts stop in a banner with *Keep this branch's version / Keep X's version / I fixed it myself*, *Cancel Merge*, *Finish Merge*; conflicts left by Update use the same banner; installed subdatasets are moved to the merged version when that is a safe fast-forward, otherwise a notice; refusals in plain language (detached HEAD, merge already open, unrelated histories, a new file in the way). Add to the "Upgrade notes" nothing.
- `SECURITY.md`, under "Free Up Space, versions, integrity check and remotes" add a bullet: **Merge** is local git (`git merge --no-edit -- <branch>`, `finishMerge`, `abortMerge`) through the same runner, so a repository's own hooks never run and its `merge.<name>.driver` settings are not on the folder-trust allowlist (already reported); it is not a push, so it is not in the trust re-check list. Resolving a file acts only on paths git lists as unmerged; subdatasets are moved only by a local `--ff-only` merge of a clean checkout (`src/datalad/adapter.js`, `test/merge-real-git.test.js`).
- `docs/product/researcher-workflow.md`, "Alongside these…" paragraph: add *Project Setup offers **Merge Into Current Branch**; conflicts are resolved per file in the Merge banner*. And remove "merge" from anything saying merging is out of scope, if present.
- `docs/architecture/datalad-adapter-interface.md`: in "Branches" add `merge`, `finishMerge`, `abortMerge`; add one line: *`resolveConflict` and `syncSubdatasets` are adapter methods (several git calls), exposed through the `adapter:resolveConflict` IPC handler and called from `runCommand`.*

- [ ] **Step 3: Amend the spec with the four deviations**

Append to `docs/superpowers/specs/2026-10-06-merge-branches-design.md`:

```markdown
## Amendments made while planning (2026-10-06)

- `resolveConflict` and the subdataset sync are adapter methods with an IPC handler, not `COMMAND_SCHEMAS` commands (they need several git calls). The sync runs inside `runCommand` after a successful `merge`/`finishMerge`; its notes are returned as `warnings`.
- The conflict-marker check for "I fixed it myself" requires both a `<<<<<<< ` line and a `>>>>>>> ` line.
- During a merge Save is hidden and disabled with guidance.
- Merge state is read from `MERGE_HEAD`, before a merge too (a second merge is refused).
```

- [ ] **Step 4: Full verification**

Run: `npm test 2>&1 | grep -E '^ℹ (pass|fail|skipped)'` then `env -u ELECTRON_RUN_AS_NODE node --test e2e/merge.e2e.mjs`
Expected: `fail 0`; the e2e passes. Re-read the README diff once for wording.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md SECURITY.md docs
git commit -m "docs: merge in the tutorials, README, changelog and security notes" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review (done before handing over)

- **Spec coverage:** commands (T1), conflict-as-state + refusals (T2), status fields incl. Update's conflicts (T3), per-file resolve incl. deletion/subdataset/manual (T4), subdataset sync (T5), annexed files (T6), UI picker/banner/Save/branch blocking/identity (T1, T7, T8), errors (T2), security note (T9), tutorials 03–06 (T9), e2e (T8). Not in the spec's list but required to build it: IPC + preload (T4).
- **Placeholders:** none; every code step has code. Two steps say "read the failure and adjust" (T5 git refusing, T8 e2e waits) because the outcome depends on git's exact behaviour; each names what to do.
- **Type consistency:** `parseUnmerged` returns stage keys `'1'|'2'|'3'` (used as `stages['2']`, `['3']` in T3/T4); `sides: { ours, theirs }` booleans (T3 → T7 → T8); `result.conflicts` (T2 → T8); `mergeInProgress`/`mergeBranch` (T3 → T7); `MERGE_PREFLIGHT_ERRORS` codes match the tests in T2.
