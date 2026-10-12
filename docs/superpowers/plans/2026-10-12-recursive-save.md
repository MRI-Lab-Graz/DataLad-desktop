# Recursive Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** One Save saves the selected files (or everything changed) inside nested datasets too and leaves the project clean; the nested-dataset picker goes away.

**Architecture:** The adapter's `save` command gains `-r`. The picker markup, handler and population code are removed from the renderer; `refreshDatasetList` keeps feeding the ignore-rules scope and nested-dataset info but always keeps the root active.

**Tech Stack:** Node test runner (`npm test`), real-Electron e2e (`env -u ELECTRON_RUN_AS_NODE npm run test:e2e`, needs `datalad` + `git-annex` for the new one).

**Spec:** `docs/superpowers/specs/2026-10-12-recursive-save-design.md`

## Global Constraints

- TDD; zero new dependencies; vocabulary "save", never "checkpoint"/"commit" in UI text.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Claude cannot merge PRs; run `ponytail:ponytail-audit` before the PR.
- The `--message=<value>` form must stay one token (a message like `--amend` is not a flag).

## Review Focus

- A Save in a plain git repository with no nested datasets still works (`-r` on a project without subdatasets).
- The PRISM/BIDS "saved together" path (no paths) and the BIDS auto-nest flow still save everything.
- Selecting only a nested file saves it and records the new nested state in the root.
- After the picker is gone, nothing reads a missing element (no `null` access at startup, on project open, or on `refreshDatasetList`).
- Opening a project whose active path was a nested dataset (an old recent entry) lands on the root.

### Task 1: `-r` in the adapter's save command

**Files:** Modify `src/datalad/adapter.js` (`case 'save'`, ~line 1581), `test/adapter.test.js`.
**Interfaces:** Produces: `save` args `['-C', p, 'save', '-r', '--message=<msg>', ...(paths.length ? ['--', ...paths] : [])]`.

- [ ] **Step 1 (RED):** In `test/adapter.test.js` change every expected save argument list (lines ~506, 522, 528, 542, 1958, 1982) to put `'-r'` right after `'save'`, e.g. `['-C', '/tmp/project', 'save', '-r', '--message=checkpoint', '--', 'results.csv']`.
- [ ] **Step 2:** `node --test test/adapter.test.js` → FAIL (args differ).
- [ ] **Step 3:** In `case 'save'` use `['-C', projectPath, 'save', '-r', `--message=${message}`, '--', ...paths]` and `['-C', projectPath, 'save', '-r', `--message=${message}`]`; add the comment `// -r: nested datasets are saved too and the parent records their new state (measured with real DataLad)`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** commit `feat: Save is recursive (datalad save -r)`.

### Task 2: Remove the nested-dataset picker

**Files:** Modify `src/gui/renderer/index.html` (the `<label id="dataset-select-field">` block, ~line 311), `src/gui/renderer/app.js`; test `test/round1-cleanup.test.js` (append) or a new `test/recursive-save.test.js`.

- [ ] **Step 1 (RED):** new `test/recursive-save.test.js` reading `index.html` and `app.js` (LF-normalised, like `test/diff-wiring.test.js`): assert `html` has no `dataset-select`, `refresh-datasets` or "pick which one Save applies to"; assert `app` has no `datasetSelect`, `datasetSelectField`, `refreshDatasetsButton`; assert the `refreshDatasetList` body (slice to `\n}\n`) contains `elements.commandProjectPath.value = datasets[0].path` hmm no: assert it still calls `renderIgnoreRules`-feeding `state.datasets = datasets` and that it never assigns `commandProjectPath.value` to anything other than the root (`datasets.find((dataset) => dataset.relativePath === '.')`).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Delete the markup block; in `app.js` delete the three `elements` entries (`datasetSelectField`, `datasetSelect`, `refreshDatasetsButton`), the `refreshDatasetsButton` click handler (~1137) and the `datasetSelect` change handler (~1451). In `refreshDatasetList` delete the dropdown population (`elements.datasetSelect.*`, `hasNestedDatasets`-driven `hidden`), and choose the active folder as the root: `const root = datasets.find((dataset) => dataset.relativePath === '.') ?? datasets[0]; const nextPath = root?.path`, then keep the existing `commandProjectPath`/header/refresh sequence.
- [ ] **Step 4:** `npm test` → PASS; run `env -u ELECTRON_RUN_AS_NODE node --test --test-concurrency=1 e2e/science-workflow.e2e.mjs e2e/files-browser.e2e.mjs` → PASS.
- [ ] **Step 5:** commit `feat: remove the nested-dataset picker; Save acts on the whole project`.

### Task 3: Real-DataLad e2e

**Files:** Create `e2e/recursive-save.e2e.mjs`.

- [ ] **Step 1:** project = `datalad create` root + `datalad create -d <root> <root>/sub`; commit baseline with `datalad save -r`; then write `new-root.txt` in the root and `new-sub.txt` inside `sub`; open in the app; message "both"; click Save; wait for `Save (completed|failed)`; assert `git status --porcelain` is empty in both root and `sub`, and `git -C sub log` has the message "both". Second test: write `again.txt` in `sub` only, select only it (uncheck others by clicking the checkboxes), Save with message "nested only", assert root clean (`git status --porcelain` empty: the root recorded the new sub state).
- [ ] **Step 2:** prove it bites: temporarily remove `'-r'` from the adapter, run the e2e (must FAIL on a non-clean root), restore with `git checkout -- src/datalad/adapter.js`.
- [ ] **Step 3:** run it with `-r` → PASS; run the full e2e suite.
- [ ] **Step 4:** commit `test: e2e for recursive Save with a nested dataset`.

### Task 4: Docs, review, PR

- [ ] README feature bullet / tutorial mention (grep `nested` in `README.md docs/tutorials docs/product`): one sentence that Save includes nested datasets. Run `npm test`.
- [ ] Final: fresh Opus review of the branch, `ponytail:ponytail-audit`, push, open the PR against `main` (the maintainer merges).
