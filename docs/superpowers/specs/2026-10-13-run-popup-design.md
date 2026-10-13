# Round 4: Run & record (`datalad run`)

Date: 2026-10-13. Branch `feat/run-popup`, from `main` (after PRs #25-#29).

## Goal

A scientist can run an analysis command and have the project **record exactly how a result was made**
(command, inputs, outputs), without leaving the app and without the terminal. DataLad already does the
recording; History already shows recorded runs with their command, inputs and outputs. What is missing is a
way to **start** one. Decided with the maintainer (2026-10-12): a minimal popup, opened from Tools → History,
with Command, Inputs, Outputs and Message. No script picker, no rerun.

Success: in a project with `data.csv`, Tools → History → **Run & record…**, command `python summarize.py`,
input `data.csv`, output `summary.txt`, message "Summary of the data" → Run. A new save appears in History
marked "recorded run", with the command shown; the project is clean afterwards.

## Measured with real DataLad (2026-10-13)

| Case | Result |
|---|---|
| clean project, `-i in.txt -o out.txt "cp in.txt out.txt"` | `run(ok)`, a `[DATALAD RUNCMD] <message>` save containing `out.txt` |
| project with an unsaved change | `run(impossible): clean dataset required to detect changes from command`, **exit 1**, nothing run |
| command exits non-zero | `run(error)`, **exit 1**, nothing recorded (partial outputs stay as unsaved changes) |
| one command string with a pipe and a redirect, and a glob input (`nums*.txt`) | works: the string goes to the system shell |
| `-i nope.txt` (missing input) | `run(error): Input did not match existing file: nope.txt` |
| `-o ../escape.txt` | **accepted silently** (the app must reject `..` itself) |
| plain git repository (no dataset) | works too |

## Behaviour

**Entry.** Tools → History gets a **Run & record…** button (disabled with no project open). It opens a modal
`<dialog>` with:

- **Command** (required, monospace, 2-3 lines): "Runs in the project folder through your system shell
  (cmd.exe on Windows), like a terminal. Pipes and redirects work."
- **Inputs** (optional, one path or pattern per line): "Files the command reads. They are downloaded first if
  they are not on this computer."
- **Outputs** (optional, one per line): "Files the command writes. Existing ones are made writable first."
- **Message** (required; pre-filled `Run: <start of the command>`): becomes the save message.
- A notice and a disabled **Run & record** button while the project has unsaved changes: "Save your changes
  first, so the result contains only what this command made." (DataLad refuses a dirty project anyway.)

**Run.** One click starts it through the existing run machinery: the running strip shows it with live output and
**Cancel**; the whole process tree is stopped on cancel. When it ends the dialog closes, History, Files and the
status line refresh, and the result panel shows the outcome. Needs a git identity like Save does.

**Friendly errors** (mapped from DataLad's output): unsaved changes → "Save your changes first, then run
again"; missing input → "An input file was not found: <path>"; command failed → "Your command stopped with an
error, so nothing was recorded. Files it already changed are left as unsaved changes: save or discard them."

## Components

| Unit | Responsibility |
|---|---|
| `src/datalad/schema.js` | `run` request: required `projectPath`, `message`, `command`; optional `inputs`, `outputs` (arrays of strings). Rejects: empty or non-string command, a command starting with `-` (DataLad would parse it as an option), NUL, command over 10 000 characters, more than 200 inputs/outputs, absolute or `..` input/output paths, message starting with `-`. |
| `src/datalad/adapter.js` | `run` in `CURATED_COMMANDS`; args `['-C', p, 'run', '--message=<m>', '--input=<i>'..., '--output=<o>'..., '<command>']`: the values are bound to their flags; the command is the last plain argument (measured: after `--` DataLad takes a single string as one *program name*, not a shell line). |
| `src/datalad/errors.js` | the three friendly errors above. |
| `src/gui/main.js` | in `adapter:runCommand`: for `run`, refuse when the admin switch is on, then **ask in a native dialog** showing project and exact command before anything runs. |
| `src/gui/policy.js` | `runDisabled` from `policy.json` or `DATALAD_DESKTOP_DISABLE_RUN=1` (as the removed console had). |
| `src/gui/renderer` | the dialog, its gating, `actionLabel('run')`, `'run'` in the identity-guard commit list, History refresh after a run. |

## Security (this re-introduces "run a typed command"; the console was removed for that reason)

- **The command is the user's own, typed in a form, and shown back in a native confirmation dialog in the main
  process before every run.** A compromised page therefore cannot run anything without a person clicking Run in
  a dialog it cannot draw or click. (The e2e auto-confirm seam is unpackaged-only, as for other native dialogs.)
- Only available for an authorized, trusted project folder (the existing gate on `adapter:runCommand`).
- **Administrators can remove it**: `DATALAD_DESKTOP_DISABLE_RUN=1` or `{"runDisabled": true}` in the system
  `policy.json`; the button is hidden and the main process refuses. Documented in `SECURITY.md`.
- Message, input and output values are bound to their flags (`--message=`, `--input=`, `--output=`); a command
  that starts with `-` is refused, so nothing a person types can become a DataLad option.
- Honest limit, stated in `SECURITY.md`: the command runs with the user's permissions through the system shell;
  on Windows `cmd.exe` also looks in the project folder first, so a hostile project could shadow a program name.
  The confirmation dialog and folder trust are the controls; this is not a sandbox.

## Testing

TDD. Schema and adapter: exact arguments (including a message and paths that look like flags, spaces,
globs), each rejection, error mapping from real DataLad output. Source-text tests for main-process confirmation
and policy, renderer wiring, the identity-guard list. Real DataLad e2e: a run records a `[DATALAD RUNCMD]` save
and History shows the chip and the command; a dirty project and a missing input give the friendly errors;
the admin switch hides the button. **Cancel e2e is restored** (the three tests deleted with the console in round
1), now driven by `run`: the process is really gone after cancel, output streams as activity events, and
the Cancel button in the running strip stops it.

## Out of scope

Re-running a recorded run, a script picker, saved or templated commands, a command history, `--explicit`
runs on a dirty project, containers/environments, and showing run commands anywhere beyond History.
