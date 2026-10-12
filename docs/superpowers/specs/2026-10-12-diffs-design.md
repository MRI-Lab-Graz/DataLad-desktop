# Round 2: "What changed in this file?" (diff view)

Date: 2026-10-12. Branch `feat/diffs`, from `main` after PRs #25 and #26.

## Goal

Scientists can see *what* changed in a file, not only *that* it changed: before they save
(Home), and when they look back (History). One diff view serves both, so it is built once.
Decisions agreed with the maintainer on 2026-10-12: inline on Home (not a side panel);
"Compare with now" on a save or version in History; text files get a line diff with changed
cells highlighted for TSV/CSV; large output is cut at about 500 lines with "show the rest";
binary and annexed data files show only "changed" and their sizes.

Success: with a changed `participants.tsv`, one click under its row in Files To Save shows
which cells changed; in Tools → History, **Compare with now** on `paper-v1` lists every file
that differs since then and each opens the same view.

## Behaviour

### Home: Show changes
Each row in Files To Save (top-level files, not nested-subdataset children) gets a small
**Show changes** toggle. Opening it loads the diff of that file between the last save (`HEAD`)
and the working tree and shows it under the row; closing it hides it. New (untracked) files
show their content as all-added lines; a deleted file shows its last saved content as
all-removed lines. The diff is loaded on click, never for the whole list.

### History: Compare with now
In the save detail panel (Tools → History), next to Restore and Branch-from-here, a
**Compare with now** button lists the files that differ between that save and the working
tree (status letter + name, via `git diff --name-status -z <save>`), each with the same
**Show changes** toggle, here diffing that save against the working tree. A save that has no
differences says "No differences since this save."

### The diff view (`renderDiffHtml`)
- **Text files:** unified diff with three lines of context; added lines green, removed red,
  hunk headers muted. Line numbers are not shown (keeps it narrow).
- **TSV and CSV** (`.tsv`, `.tab`, `.csv` by extension): when a removed line is directly followed
  by an added line, both are split on the file's separator (tab or comma, a quoted-field-unaware
  split) and the cells that differ get a stronger highlight, so a one-cell edit in a wide table
  is visible at a glance. Lines with a different number of cells fall back to the plain line diff.
- **Cap:** the first 500 diff lines are shown, then "Showing 500 of N lines — Show the rest"
  which re-requests up to 20 000 lines; beyond that it says so and stops.
- **Binary or annexed data files:** no diff, one line: "Data file changed (not shown as text)"
  with old and new size when known. Sizes: a regular file's size from `git cat-file -s` /
  `fs.stat`; for annexed content (symlink or pointer text containing `-s<bytes>--`) the size
  is read from that key. Unknown sizes are omitted, never guessed.
- All text is escaped with `escapeHtml`; the view never uses `innerHTML` with file content.

## Components

| Unit | Responsibility |
|---|---|
| `src/datalad/adapter.js` `getFileDiff(projectPath, request)` and `listChangesSince(projectPath, commitHash)` | Run read-only git, return plain data (below). |
| `src/gui/main.js` handlers `adapter:getFileDiff`, `adapter:listChangesSince` | `requireAuthorizedRoot`, validate arguments, call the adapter. Classified in `test/trust-wiring.test.js`. |
| `src/gui/preload.js` | `getFileDiff(projectPath, request)`, `listChangesSince(projectPath, commitHash)`. |
| `src/gui/renderer/diff-view.js` (pure) | `parseUnifiedDiff(text)`, `splitCells(line, separator)`, `cellChanges(oldLine, newLine, separator)`, `renderDiffHtml(diff, { maxLines })`. |
| `src/gui/renderer/app.js` + `index.html` + `styles.css` | Toggle on Home rows, Compare button and list in History, loading and error states. |

### Adapter contract
`getFileDiff(projectPath, { path, against })` where `against` is `'HEAD'` (Home) or a commit
hash (History); the other side is always the working tree. Optional `maxLines` (default 500,
at most 20 000). Returns
`{ kind: 'text' | 'binary' | 'unchanged', status: 'added' | 'deleted' | 'modified' | 'renamed',
lines: [{ type: 'hunk' | 'context' | 'add' | 'del', text }], totalLines, truncated, oldSize, newSize }`.
`listChangesSince(projectPath, commitHash)` returns `[{ status, path }]`.

### Security (read-only, but git diff can run programs)
- Every diff call passes `--no-ext-diff --no-textconv --no-color` so an
  `diff.<driver>.command`, `textconv` or `diff.external` from repository config or
  `.gitattributes` never runs. A test pins both flags on every new git call.
- Pathspecs follow `--`; the path must be relative, free of `..`, and is never a flag. The
  commit must match `COMMIT_HASH_PATTERN`. Both are validated in the adapter.
- Names come from `-z` output (NUL-separated), so names with spaces, quotes or non-ASCII are
  exact. Untracked-file content is read with a size cap, only inside the authorised project root.
- No new write path; no trust prompt needed beyond what `getCommitDetails` already requires.

## Adjacent fix, in scope
`getCommitDetails` lists changed files with `diff-tree --name-only` without `-z`, so names with
spaces come back quoted (the same bug fixed for status in PR #27) and Restore on such a file
fails. The list that **Compare with now** shows is built with `-z`; `getCommitDetails` is
switched to `-z` too so History's file list and its Restore buttons get the real names.

## Testing

TDD per unit. Pure: `diff-view.js` (parsing, cell highlight, cap, escaping, TSV vs CSV vs plain,
unequal cell counts, empty lines). Adapter with the repo's fake runner: exact git arguments
(including the two safety flags, `--`, `-z`), binary/annexed size handling, truncation,
untracked and deleted files, invalid hash and path rejection. Source-text tests for the handler
classification, preload and the markup. Real Electron e2e: a changed TSV shows the changed cell;
**Compare with now** on an older save lists the file; a file with a space in its name works;
a repository with a malicious `diff.*.command` / `textconv` attribute does **not** run it.

## Out of scope

Side-by-side view, word-level diff for prose, syntax highlighting, image or NIfTI previews,
diffing nested-subdataset children, "what did this save change?" for a single past save
(the History file list already shows that as a stat), and the recursive Save / `datalad run`
rounds.
