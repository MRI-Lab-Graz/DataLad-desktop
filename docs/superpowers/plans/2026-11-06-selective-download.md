# Choose data to download or free up — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A BIDS/PRISM-aware panel in the Files tab to download or free up exactly the chosen subjects, sessions, modalities, tasks and file types.

**Architecture:** Pure, tested modules parse BIDS names, build filter groups, select files, add paired companions and batch paths. A new adapter method lists annexed files (present?, size). The renderer shows the panel and calls the existing `get`/`drop` commands in batches. Two new curated commands: `installSubdatasets` and `dropReckless` (the latter behind a typed word and a native confirm).

**Tech Stack:** Node built-ins only (no new dependency), Electron renderer ES modules, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-06-selective-download-design.md`

## Global Constraints

- Priorities: security > usability > Windows first. Fail closed.
- No new npm dependency.
- TDD: failing test first, watch it fail, then minimal code. Tests run with `npm test`.
- Nothing is ticked at the start; nothing selected = no command runs. No automatic downloads.
- Entities parsed generically as `key-value`; PRISM order `sub, ses, task, acq, run, rec, dir, echo, ce, part, space, desc`.
- Groups: Subjects, Sessions, Modalities, other entities with more than one value, Type (suffix), File ending. One-value groups hidden. Ticked groups AND; values inside a group OR; All/None per group.
- Download pairs with same-name companions plus dataset-level/inherited files; Free up only same-name companions.
- Download lists/counts only files without content; Free up only files with content. Unknown size → "size unknown".
- Free up: `datalad drop`, content only, never uninstalls subdatasets. Reckless only after a normal drop failed, typed word `delete` (case-insensitive), native confirm in main, stops remaining batches on first failure, never default, never remembered.
- Windows: batch paths under 6000 characters per command (cmd.exe limit 8191); non-ASCII names must work.
- Plain words in the UI; BIDS keys only as hints, e.g. "Task (task-)".
- Before merge: `ponytail:ponytail-audit`, `security-review`, `superpowers:verification-before-completion`; read CI results.

## Review Focus

- Non-ASCII or spaced subject/file names survive batching and quoting (Windows).
- A file without `ses-` when Sessions is filtered does not match (except paired dataset-level files).
- Empty selection: buttons disabled, no command can be started.
- Stop/failure mid-batch: remaining batches do not run; summary says what was done.
- Non-BIDS names or a single-subject project: groups hidden, no garbage filters.
- A project with ~50,000 files builds groups in well under a second.
- Paths sent by the page that escape the project are refused (existing path assertion covers new commands).

## File Structure

- Create `src/gui/renderer/bids-path.js` — `parseBidsPath`.
- Create `src/gui/renderer/data-selection.js` — groups, filtering, pairing, summary, batching.
- Create `src/gui/renderer/data-panel.js` — HTML for the panel from groups + selection (pure, tested).
- Modify `src/datalad/adapter.js` — `listDataFiles`, commands `installSubdatasets`, `dropReckless`.
- Modify `src/datalad/schema.js`, `src/gui/main.js`, `src/gui/preload.js` — wire the new commands/IPC.
- Modify `src/gui/renderer/index.html`, `app.js`, `button-gating.js`, `styles.css` — the panel.
- Modify `SECURITY.md`, docs — the reckless rule and the new panel.
- Tests: `test/bids-path.test.js`, `test/data-selection.test.js`, `test/data-panel.test.js`, `test/data-list-real-annex.test.js`, additions to `test/adapter.test.js`, `test/files-data-actions.test.js`.

---

### Task 1: Read BIDS names

**Files:** Create `src/gui/renderer/bids-path.js`; Test `test/bids-path.test.js`

**Interfaces:**
- Produces: `parseBidsPath(path: string): { path, sub: string|null, ses: string|null, modality: string|null, entities: Record<string,string>, suffix: string|null, ext: string|null, datasetLevel: boolean }`. `path` is project-root-relative with `/`. `entities` holds every `key-value` pair of the file name (including sub/ses). `modality` is the folder directly above the file when the path is `sub-*/[ses-*/]<folder>/file`. `ext` includes everything after the first `.` of the file name (`nii.gz`, `tsv`, `json`). `datasetLevel` is true when the path has no `sub-` folder.

- [ ] **Step 1: Failing tests** (names and assertions)
  - `parses a func file`: `sub-01/ses-1/func/sub-01_ses-1_task-imagery_acq-Fs2_run-01_bold.nii.gz` → `sub:'01', ses:'1', modality:'func', entities:{sub:'01',ses:'1',task:'imagery',acq:'Fs2',run:'01'}, suffix:'bold', ext:'nii.gz', datasetLevel:false`.
  - `a file without a session has ses null`: `sub-01/anat/sub-01_T1w.json` → `ses:null, modality:'anat', suffix:'T1w', ext:'json'`.
  - `dataset-level files`: `participants.tsv` and `task-imagery_bold.json` → `datasetLevel:true, sub:null`.
  - `non-ASCII and spaces are kept`: `sub-Ünï 1/anat/sub-Ünï 1_T1w.nii.gz` → `sub:'Ünï 1'`.
  - `names that are not BIDS give no entities`: `notes/readme.txt` → `entities:{}, suffix:null, modality:null`.
- [ ] **Step 2:** `node --test test/bids-path.test.js` → FAIL (module missing).
- [ ] **Step 3:** Implement `parseBidsPath` in `src/gui/renderer/bids-path.js` (split name at first `.`, split stem on `_`, last part without `-` is the suffix).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: read BIDS names`.

### Task 2: Filter groups and file selection

**Files:** Create `src/gui/renderer/data-selection.js`; Test `test/data-selection.test.js`

**Interfaces:**
- Consumes: `parseBidsPath` (Task 1).
- Produces:
  - `type DataFile = { path: string, present: boolean, bytes: number|null }`
  - `buildFilterGroups(files: DataFile[]): Group[]` where `Group = { key: string, title: string, hint: string, values: string[] }`. Keys: `sub`, `ses`, `modality`, then each other entity key in PRISM order (unknown keys alphabetical after), then `suffix`, `ext`. Groups with fewer than two distinct values are omitted. Values sorted naturally. Titles: Subjects, Sessions, Modalities, "Task", "Acquisition", "Run", "Type", "File ending", others by key; hints like `task-`.
  - `type Selection = Record<string, Set<string>>` (missing/empty key = untouched).
  - `selectFiles(files: DataFile[], selection: Selection, mode: 'get'|'drop'): DataFile[]` — keeps files whose `present` is `false` for get / `true` for drop, that match every touched group; a file lacking that entity does not match.
- [ ] **Step 1: Failing tests** with a small fixture of ~12 files over 2 subjects, ses-1, anat/func, two tasks:
  - `groups: one-value entities are hidden` (ses with only `1` is absent).
  - `groups: order is sub, ses, modality, task, acq, run, suffix, ext`.
  - `nothing ticked selects nothing`: empty selection with get → `[]` (decided: untouched everything means no selection; see below).
  - `ticking Subjects and Modalities intersects`.
  - `a file without ses- does not match a ses filter`.
  - `get skips files already present; drop skips files not present`.
  - `values inside a group are OR`.
  - `50000 files build groups in under 1000 ms`.
  Note: `selectFiles` with every group untouched returns `[]` (an explicit All tick per group, or any group touched, is required). Test names above pin this.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat: filter groups and selection`.

### Task 3: Paired companions, summary and batching

**Files:** Modify `src/gui/renderer/data-selection.js`; Test `test/data-selection.test.js`

**Interfaces:**
- Produces:
  - `withCompanions(selected: DataFile[], all: DataFile[], mode: 'get'|'drop'): DataFile[]` — adds, deduplicated, files in `all` that share the selected file's path minus extension (`…_bold.nii.gz` → `…_bold.json`, `…_events.tsv` is matched via same stem without the suffix: same entities, suffix `events`; `.bvec`/`.bval` via same stem). For `'get'` also adds dataset-level files (`datasetLevel`) such as `participants.tsv`, `dataset_description.json`, and top-level `task-*_*.json` whose entities are a subset of a selected file's entities. For `'drop'` only same-name companions. Companions are filtered by the mode's presence rule like Task 2.
  - `summarize(files: DataFile[]): { count: number, bytes: number, unknownSize: number }`.
  - `batchPaths(paths: string[], maxChars = 6000): string[][]` — each batch's joined length (sum of path lengths plus one per path) stays at or under `maxChars`; a single longer path gets its own batch; order preserved.
- [ ] **Step 1: Failing tests:** `bold.nii.gz brings its json and events tsv`; `get adds participants.tsv and dataset_description.json, drop does not`; `inherited top-level task json is added only when its entities fit`; `summary counts unknown sizes separately`; `batches stay under the limit and keep non-ASCII paths intact`; `an oversized path is a batch of one`.
- [ ] **Steps 2–5:** FAIL, implement, PASS, commit `feat: pairing, summary, batching`.

### Task 4: List annexed files with presence and size

**Files:** Modify `src/datalad/adapter.js`; Test `test/adapter.test.js` (fake runner) and `test/data-list-real-annex.test.js` (real git-annex; skipped when `git annex` is missing, like `merge-real-git.test.js`)

**Interfaces:**
- Produces: `DataLadAdapter#listDataFiles(projectPath: string): Promise<DataFile[]>` — root plus every installed subdataset up to `MAX_SUBDATASET_DEPTH`, paths relative to `projectPath` with `/`. Runs `git annex find --include=* --format=${file}\t${bytesize}\t${present}\n`-style listing per repository (builder chooses exact git-annex flags; must be read-only and must not initialise annex in a repo that does not use it, mirroring `list-directory.js`). Files not annexed are omitted. `bytes` is `null` when unknown.
- [ ] **Step 1: Failing tests:** fake-runner test that parses two repos' output into relative paths with `present` and `bytes:null` for an unknown size; real-annex test: create a repo with one present and one dropped annexed file and expect `[ {present:true}, {present:false} ]` with correct paths.
- [ ] **Steps 2–5:** FAIL, implement, PASS, commit `feat: list annexed files with presence and size`.

### Task 5: Install missing subdatasets without content

**Files:** Modify `src/datalad/adapter.js` (`CURATED_COMMANDS`, `#buildCommand`), `src/datalad/schema.js`; Test `test/adapter.test.js`

**Interfaces:**
- Produces: command `installSubdatasets` with request `{ projectPath, paths }` (required non-empty) → `datalad -C <projectPath> get -n -- <paths>`.
- [ ] **Step 1: Failing tests:** `installSubdatasets runs datalad get -n for the paths`; `installSubdatasets refuses empty paths`; `refuses a path outside the project` (existing path assertion).
- [ ] **Steps 2–5:** FAIL, implement, PASS, commit `feat: installSubdatasets command`.

### Task 6: Reckless drop, behind its own gate

**Files:** Modify `src/datalad/adapter.js`, `src/datalad/schema.js`, `src/gui/main.js`, `SECURITY.md`; Test `test/adapter.test.js`, `test/files-data-actions.test.js`

**Interfaces:**
- Produces: command `dropReckless` with `{ projectPath, paths }` (required non-empty) → `datalad -C <projectPath> drop --what filecontent --reckless kill -- <paths>`. Plain `drop` also gains `--what filecontent` (still never `--reckless`).
- In `main.js` (`adapter:runCommand`): `dropReckless` requires an authorised root, runs `confirmNative` ("Delete without a safety check?", detail says the data may be gone for good if no other copy exists, confirm label "Delete") before running, and returns the existing declined result when refused. It is never reachable through `drop`.
- [ ] **Step 1: Failing tests:** `drop uses --what filecontent and never --reckless`; `dropReckless builds the reckless command`; `dropReckless is refused without paths`; wiring test that `main.js` calls `confirmNative` for `dropReckless` before `adapter.runCommand`, and that declining returns without running.
- [ ] **Step 2–3:** FAIL; implement; update the "no --reckless here, ever" comment to say reckless is only the separate `dropReckless` command. **Step 4:** PASS.
- [ ] **Step 5:** Edit `SECURITY.md`: describe `dropReckless` (typed word in the page, native confirm in main, never used by Get/Save/default drop). Commit `feat: separate reckless drop with typed and native confirmation`.

### Task 7: The panel

**Files:** Create `src/gui/renderer/data-panel.js`; Modify `src/gui/renderer/index.html`, `app.js`, `button-gating.js`, `styles.css`, `src/gui/preload.js`, `src/gui/main.js` (IPC `adapter:listDataFiles`); Test `test/data-panel.test.js`, `test/files-data-actions.test.js`, `test/button-gating.test.js`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: `renderDataPanel({ groups: Group[], selection: Selection, summary: {count,bytes,unknownSize}, mode: 'get'|'drop' }): string` — escaped HTML with a checkbox per value (`data-group`, `data-value`), All/None per group, a plain summary line ("12 files, about 1.4 GB" / "size unknown for 2 files"), and the action buttons disabled when `summary.count === 0`. Also `formatBytes(n: number): string`.
- Panel behaviour in `app.js`: shown only when `state.rootProjectIsBids`; loads files with `api.listDataFiles(projectPath)` when opened and after a get/drop; **Download selected** runs `withCompanions(selectFiles(...))` through `batchPaths`, calling `runWorkflowCommand('get', { projectPath, paths })` per batch and stopping at the first failure or Stop (reuse `shouldStopSequence`); first runs `installSubdatasets` for selected subjects whose subdataset is missing. **Free up space** runs `drop` the same way; when it fails or the remote is unreachable, offers a separate "Delete without safety check" dialog requiring the typed word `delete` (case-insensitive), then `dropReckless`. Get all gains a confirm with file count and size.
- [ ] **Step 1: Failing tests:** `panel hides groups the data does not have`; `panel escapes values` (a subject named `<b>`); `buttons are disabled with an empty selection`; `summary shows size unknown`; wiring tests in `files-data-actions.test.js`: panel markup exists in `index.html`; `app.js` imports the modules and calls `batchPaths`, `withCompanions`, `installSubdatasets`; reckless dialog asks for the typed word and is separate from the Free up button; Get all confirms; button-gating disables the panel buttons while a command runs.
- [ ] **Steps 2–5:** FAIL, implement, PASS, commit `feat: Choose data panel`.

### Task 8: Docs and proof on real data

**Files:** Modify README/docs (one short section "Download only what you need", and the Free up space wording); Test `test/docs-link.test.js` stays green.

- [ ] **Step 1:** Add the doc section in plain words with the reckless warning.
- [ ] **Step 2:** `npm test` → all green, read the output.
- [ ] **Step 3:** Run the app on a clone of `/Volumes/Evo/test_world/test-world-remote` (use the `run` skill, unset `ELECTRON_RUN_AS_NODE`): tick one subject + `func` + `task-imagery`, check the summary matches `git annex find --not --in=here`, download, confirm only those plus sidecars arrived, then free them again. Record what was seen.
- [ ] **Step 4:** Run `ponytail:ponytail-audit`, `security-review`, `superpowers:verification-before-completion`; fix or consciously decline findings. Push the branch, open the PR on GitHub, read the CI results (Claude cannot merge).
