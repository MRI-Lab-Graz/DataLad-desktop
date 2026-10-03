# PRISM badge and Save gate — Design

Spec **A** of the PRISM-validator work. Builds on spec B (`2026-10-03-managed-env-design.md`, built):
the validator lives in the app-managed env and is found via `envBin(envDir, 'prism-validator')`.
Out of scope: validation on Publish (the DataLad server validates pushes elsewhere), the standard
BIDS validator / Deno (`--bids`), `--fix`, validating on project open, result caching, a PRISM chip
in Project Health, the UI simplification work.

## Goal

For a PRISM project, Save is allowed only when the PRISM validator reports the whole project valid,
so invalid data never reaches the DataLad server. Non-PRISM projects are unaffected.

## Decisions (agreed)

- **PRISM project** = `project.json` in the project root. Gets a dedicated "PRISM" badge beside "BIDS".
- **Gate** = validate the whole project with `prism-validator <path> --format json` (PRISM checks
  only; no `--bids`). Verdict is `results.valid === true` and `summary.total_errors === 0`.
  Warnings never block. Exit codes are not relied on.
- **Exemption**: the save that introduces `project.json` (not present in HEAD, or no HEAD) is not
  validated, so a messy import can get its first checkpoint.
  The conversion save always saves everything (so `project.json` really enters HEAD) and is refused
  while git ignores `project.json`; otherwise the exemption would never end.
- **Repo root**: a save from a subfolder commits the whole repo, so the gate resolves
  `git rev-parse --show-toplevel` and decides on, and validates, the root. Not a git repo (exit 128):
  nothing can be committed, so nothing is gated. `project.json` is detected with `lstat` (an annexed,
  not-yet-fetched file is a dangling symlink and still counts).
- **Fail closed**: crash, timeout (5 min), bad JSON, unknown report shape, cancel, or validator not
  installed all block Save. Escape hatch is the opt-in Power User Console (plain `datalad save`,
  no gate); nothing else.
- **Save everything**: for a gated PRISM save the main process clears `request.paths`, so exactly
  the validated tree is committed (`datalad save` without paths saves all changes).
- Enforcement is in the **main process** (the single `adapter:runCommand` choke point), above both
  the JS and the Rust adapter. The renderer only displays; it never decides.

## Components

New `src/datalad/prism-gate.js` (Electron-free, injected runner, fake-runner tests):

- `isPrismProject(projectPath)` — `project.json` exists in the root.
- `isConversionSave({ runner, projectPath })` — `git -C <p> cat-file -e HEAD:project.json`; non-zero
  exit = not in HEAD = exempt.
- `interpretReport(stdout)` → `{ verdict: 'valid' }` |
  `{ verdict: 'invalid', errorCount, errors }` (first 10 `results.errors` entries, each one line:
  `path: message` if present, else the entry's JSON) | `{ verdict: 'unknown', reason }`.
- `gateSave({ runner, projectPath, validatorBin, validatorReady, signal, onOutput, timeoutMs = 300000 })`
  → `{ allow: true, saveAll }` | `{ allow: false, result }`, where `result` has the identity-guard shape
  (`ok:false, failed:true, exitCode:1, stdout:'', stderr:'', warnings:[]`, `userError{code,title,message,technicalDetails}`).
  Codes: `PRISM_INVALID`, `PRISM_UNCHECKED`, `PRISM_VALIDATOR_MISSING`.
  Order: not PRISM → allow; conversion save → allow; validator missing → block; run validator;
  cancelled/runner failure/`unknown` → `PRISM_UNCHECKED`; `invalid` → `PRISM_INVALID`; `valid` → allow.
  `saveAll` tells `main.js` to clear `request.paths` (true for every PRISM save, including the conversion save).

`main.js`: `adapter:runCommand` for `save` runs `gateSave` inside `runWithHandle` (cancellable, shows
in the Running-commands strip); blocked → return `result` without calling the adapter; allowed and
gated → `paths = []`. New IPC `prism:inspect(projectPath)` (authorised root) → `{ isPrism, validatorReady }`
for the badge and hints only; the gate never trusts it. `preload.js` exposes `inspectPrism`.

Renderer: PRISM badge (pattern of `current-project-bids-badge`), `state.rootProjectIsPrism` set from
`prism:inspect` on open/switch; for PRISM, Save no longer requires a file selection and shows the hint
"PRISM project: your data is checked before every save, and everything is saved together." (the
checkboxes are not visually locked — the main process enforces all-changes regardless; ponytail:
lock them if researchers find that confusing); the
conversion save shows "This save adds project.json — checking starts with your next save."; block
display reuses `userError.title/message` and lists `PRISM_INVALID` errors beneath; `PRISM_VALIDATOR_MISSING`
shows an "Open Setup" button (the install itself stays in Setup → PRISM Validator from spec B); `PRISM_UNCHECKED` is retried via Save.

Copy: invalid — "Your data doesn't pass the PRISM check yet (N problems). Fix them and save again.";
unchecked — "Couldn't check your data, so nothing was saved. Try again."; missing — "The PRISM check
needs a one-time install."

## Known limits

- The `results.errors` entry shape is unknown (only a valid-dataset sample exists); entries are shown
  generically until an invalid report is available. Verify against a real invalid dataset.
- The CLI's default mode is assumed PRISM-only without `--bids`; the Studio sample reports
  `validation_mode: "both"`. Verify in the manual check.
- Deleting `project.json` skips the local gate; the server still rejects invalid pushes.
- Validation time scales with dataset size; only the 5-minute timeout and Cancel bound it.

## Testing (TDD, red first)

Fake runner (no network, no real validator): `isPrismProject` true/false; `isConversionSave` for
no-HEAD, HEAD without and with `project.json`; `interpretReport` for the real valid sample, invalid
(counts, 10-entry cap, one-line formatting for `{path,message}` and for arbitrary objects),
`valid:true` with `total_errors>0` (→ invalid), bad JSON, missing `results.valid`; `gateSave` for each
decision-order branch including cancel and timeout, and that `gated` is true only for non-conversion
PRISM saves; main-process wiring for `paths` clearing via a small pure helper. Renderer pure helpers
(badge/hint selection) get unit tests like `save-gating.js`. One manual run with the real validator
(blocked on the PyPI release) before calling A done.

## Review outcome (2026-10-03)

Fixed after the final review: subfolder saves bypassing the gate, a conversion exemption that could
be reused forever, and annexed (dangling) `project.json` switching the gate off. Deferred minors:
a timeout that still printed a complete valid report is allowed; `valid:true` with a non-empty
`errors` array and no summary is allowed; a Cancel click in the gap between the gate and the save is
ignored; any git exit 128 counts as "not in HEAD"; `createSubdataset` commits to a PRISM parent
unvalidated; the badge does not refresh when `project.json` appears on disk; edits made during a
long validation get committed.
