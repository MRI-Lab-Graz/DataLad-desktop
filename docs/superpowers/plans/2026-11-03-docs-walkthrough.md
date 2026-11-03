# Docs walkthrough (`npm run walkthrough`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command that drives the real app through the Read the Docs tutorials like a first-time student and prints a pass/fail checklist, so the maintainer need not click through by hand.

**Architecture:** Node's built-in runner (`node --test`) in its own folder `e2e-walkthrough/`, using the existing `launchApp` driver (`e2e/electron-driver.mjs`) and real DataLad/git-annex. One file per tutorial, one named test per tutorial step. A small harness adds a screenshot on failure. A unit test in `npm test` keeps tutorials and walkthroughs in step.

**Tech Stack:** Node test runner, playwright-core (already a devDependency). No new dependencies.

**Spec:** the design approved in chat on 2026-11-03 (summarised here; no separate document).

## Global Constraints

- Runs on macOS and Windows; build paths with `node:path` `join`, never hard-coded separators.
- Never touches the user's real settings or projects: temp folder, temp git identity (the driver already does this).
- `npm test` and CI stay unchanged and fast; the walkthrough is NOT part of `npm test`.
- `DLAD_APP_EXECUTABLE=<path>` runs a packaged app instead of the source (driver feature). In that mode the project folder must be pre-trusted via `launchApp({ trustedPaths })`; the native "create project" confirmation is never bypassed and that one step is skipped with a stated reason.
- Zero new dependencies. TDD for the harness; each walkthrough step is verified by breaking what it checks once.

## Review Focus

- A step fails while a dialog (identity, run, native confirm) is open: the failure screenshot must still be taken and the app closed, never left running.
- The temp project folder holds read-only git-annex objects: cleanup must not throw on Windows or leave the run hanging.
- A tutorial the docs gain later (e.g. `07-*.md`) with no walkthrough: the coverage test must fail until it is written or listed as not covered.
- Windows path with spaces or a long temp path in the project location field.
- `datalad`/`git-annex` missing from PATH: fail fast with one clear line, not a 60-second timeout.

---

### Task 1: Harness with failure screenshots

**Files:**
- Create: `e2e-walkthrough/harness.mjs`
- Test: `test/walkthrough-harness.test.js`

**Interfaces:**
- Produces: `export function stepRunner({ getPage, outDir }): (name: string, fn: () => Promise<void>) => Promise<void>` — runs `fn`; on throw, calls `getPage().screenshot({ path: join(outDir, <slug of name>.png) })` (ignoring screenshot errors), then rethrows the original error. `getPage` may return `undefined` (no screenshot then).
- Produces: `export function requireTools(which = (cmd) => boolean): void` — throws `Error('datalad and git-annex must be on PATH to run the walkthrough (missing: ...)')` naming each missing tool of `datalad`, `git-annex`, `git`. Default checker uses `spawnSync(cmd, ['--version'])`.

- [ ] **Step 1: Write failing tests** in `test/walkthrough-harness.test.js`: (a) `stepRunner` rethrows the same error object and calls a fake page's `screenshot` once with a path ending `tutorial-00-step-4-create-project.png` for the name `"Tutorial 00 · step 4: Create Project"`; (b) a throwing `screenshot` does not hide the original error; (c) `getPage` returning `undefined` still rethrows; (d) a passing step calls no screenshot; (e) `requireTools(() => false)` throws a message naming all three tools; `requireTools(() => true)` does not throw.
- [ ] **Step 2: Run** `node --test test/walkthrough-harness.test.js`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** both functions. Slug: lowercase, non-alphanumerics to `-`, trimmed.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: walkthrough harness (failure screenshots, tool check)`.

### Task 2: Command, coverage guard, ignore rules

**Files:**
- Modify: `package.json` (add script), `.gitignore`
- Create: `test/walkthrough-coverage.test.js`

**Interfaces:**
- Consumes: tutorial files `docs/tutorials/NN-*.md`.
- Produces: script `walkthrough`: `node --test --test-concurrency=1 e2e-walkthrough/*.walkthrough.mjs`. A walkthrough file is named `NN-<anything>.walkthrough.mjs` matching its tutorial's `NN`. `.gitignore` gains `walkthrough-failures/`.

- [ ] **Step 1: Write failing test:** every `docs/tutorials/NN-*.md` has an `e2e-walkthrough/NN-*.walkthrough.mjs` OR its `NN` is in an explicit `NOT_COVERED` array in the test (initially `['02','03','04','05','06']`); also asserts the `walkthrough` script exists in `package.json` and `.gitignore` lists `walkthrough-failures/`.
- [ ] **Step 2: Run** it. Expected: FAIL (no 00/01 files, no script, no ignore line).
- [ ] **Step 3: Add** the script and ignore line (the 00/01 files come in Tasks 3-4; keep the test red for those until then, or temporarily list them in `NOT_COVERED` and remove them there in Tasks 3-4).
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat: npm run walkthrough, coverage guard`.

### Task 3: Tutorial 00 walkthrough

**Files:**
- Create: `e2e-walkthrough/00-create-first-project.walkthrough.mjs`
- Modify: `test/walkthrough-coverage.test.js` (remove `'00'` from `NOT_COVERED`)

**Interfaces:**
- Consumes: `launchApp` (`e2e/electron-driver.mjs`; call with `identity: false` so the first-launch prompt appears), `createTempRoot` (`e2e/fixtures.mjs`), `stepRunner`/`requireTools` (Task 1).
- Produces: named tests, in order: "Tutorial 00 · step 1: Setup → Check Environment" (`#open-settings`, `#check-env`, `#environment-output` shows Python, DataLad, git-annex as OK); "step 0: first launch asks for name and email" (`#identity-overlay`, `#identity-name`, `#identity-email`, `#identity-save`); "step 3-4: Create Project" (fill `#create-project-path` with the temp root, `#create-project-name` with `pilot-study-001`, click `#create-project`); "step 5: project opens" (`#current-project-path` ends with the folder name; health card contains `project-health-grid`); "step 6-7: first save" (write `README.md`, wait for it in `#changed-files-output`, set `#message` to `init: create project skeleton and first note`, click `#save-project`, assert `git rev-list --count HEAD` grew and `git status --porcelain` is empty); "failure injection: non-empty folder is refused" (second create with the same name; `#create-project-path-hint` contains `is not empty` and no second project is made).

- [ ] **Step 1: Write the file** with the steps above as failing-first tests (run before the app flow exists is not possible; instead run once against the app and read each failure honestly: a failure that shows the tutorial is wrong is a **finding**, record it in the report, do not weaken the assertion).
- [ ] **Step 2: Run** `npm run walkthrough`. Expected: each step reports ✔ or ✖ with a screenshot in `walkthrough-failures/`.
- [ ] **Step 3: Prove each step can fail:** temporarily break one thing per step (e.g. rename the expected button id, change the expected hint text), see it go red, revert.
- [ ] **Step 4: Fix** the tutorial text where it disagrees with the real app (for example the tutorial says "choose the new folder path", the app has a Location and a Name field).
- [ ] **Step 5: Commit** `feat: tutorial 00 walkthrough`.

### Task 4: Tutorial 01 walkthrough

**Files:**
- Create: `e2e-walkthrough/01-first-checkpoint.walkthrough.mjs`
- Modify: `test/walkthrough-coverage.test.js` (remove `'01'`)

**Interfaces:**
- Consumes: same as Task 3; builds its own project with real `datalad create` and an initial save (not Task 3's project), opened via `app.openProject`.
- Produces: tests "Tutorial 01 · step 3: changed files are listed" (edited `README.md`, edited `data/raw/participants.tsv`, untracked `notes/todo.txt` all appear in `#changed-files-output`); "step 3: Show changes shows the edit" (click `.show-diff-button` for `participants.tsv`, container contains the new value); "step 4-5: save only the research files" (untick `notes/todo.txt` via its `input[data-changed-path]` checkbox); "step 6-7: Save with the message `pilot: update participant table and project summary`" (commit exists with that message; `notes/todo.txt` still untracked); "step 8: status is clean for the saved files"; "History shows the new save" (`#open-tools`, then `.tm-commit-item` list contains the message); "failure injection: ticking the scratch file saves it" (documented behaviour).

- [ ] **Steps 1-5:** as Task 3 (run, read failures honestly, prove each step can fail, fix the docs where the app disagrees, commit `feat: tutorial 01 walkthrough`).

### Task 5: Docs and a full run

**Files:**
- Modify: `README.md` (one short "Check the manual still works" section), `docs/install.md` only if a step was found wrong in Tasks 3-4.

- [ ] **Step 1:** Add to the README: how to run (`npm run walkthrough`), where failure screenshots go, the packaged-app option and its one limit, and that tutorials 02–06 are not covered yet.
- [ ] **Step 2:** Run `npm test` (all pass, including the two new unit tests) and `npm run walkthrough` on macOS. Expected: all steps ✔ or each ✖ explained as a finding.
- [ ] **Step 3:** Commit `docs: how to run the walkthrough`. Then run on Windows (the maintainer's machine) and report differences.

## Self-review notes

- Spec coverage: command (T2), real app and cleanup via driver (T3-4), checklist output (node's reporter + step names), failure screenshots (T1), tutorials 00/01 and failure injection (T3-4), coverage guard (T2), packaged option and its limit (constraints + T5), no CI (constraints). First-launch identity prompt is covered in T3.
- Not in v1: Run & record, merge and the other tutorials, screenshot comparison, wording checks.
