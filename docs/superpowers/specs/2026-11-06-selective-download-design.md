# Choose data to download or free up (BIDS / PRISM aware)

## Intent
Big files (NIfTI, EDF, …) stay on the remote. Users usually need only part of a study: some subjects, a session,
one kind of data, one task. Today they can only press Get all, or Get on one folder or file by hand.
They should instead describe what they want in BIDS/PRISM terms and fetch exactly that, and free the same
selection later to get disk space back.

## Goals
- A "Choose data" panel in the Files tab, shown for BIDS/PRISM projects.
- Filters built from the filenames that are visible after a clone (annexed files are links; names exist
  without content). No download is needed to build the lists.
- Download selected, and Free up space for the same selection.
- Honest summary before acting: file count and total size, including the paired files.

## Non-goals
- No automatic downloads, ever. Nothing selected means nothing happens.
- No new npm dependency (see zero-dependency posture); parse names with plain code.
- No copy of the PRISM entity list into the app.

## Anti-goals (a failure even if it works)
- A selection that silently fetches or drops more than the summary said.
- Dropping the last copy of data without an explicit, separate, hard-to-click-through confirmation.
- Jargon-first labels; BIDS keys appear only as small hints.

## Filters (decided with the user)
- Groups: Subjects, Sessions, Modalities (folder: anat, func, fmap, dwi, eeg, beh, survey, biometrics, biosample,
  environment, physio), then every other entity that has more than one value in the project (task, acq, run,
  rec, dir, echo, space, desc, …), then Type (suffix: T1w, bold, events, …) and File ending (.nii.gz, .json, …).
- Entities are read generically as `key-value` pairs from the filename (PRISM-specification order:
  sub, ses, task, acq, run, rec, dir, echo, ce, part, space, desc), so future entities work unchanged.
- A group with one value is hidden. An untouched group means "no filter". Ticked groups combine as AND;
  values inside a group combine as OR. Each group has All / None.
- Nothing is ticked at the start.
- Plain-word group titles with the BIDS key as a hint, e.g. "Task (task-)".

## Pairing rule (decided)
Chosen data files always bring their companions: same-name sidecars (.json, events .tsv, .bvec/.bval, …).
Confirmed by the user ("exactly"): also the dataset-level and inherited files that apply to the chosen data
(participants.tsv, dataset_description.json, top-level task-*_bold.json). The summary counts them.

## Free up space (decided: mirror of download)
- The same panel and selection, with a "Free up space" button.
- Default and only normal path: `datalad drop`, which refuses unless another copy is confirmed. Needs the
  remote to be reachable; if not, say so in plain words.
- Dedicated "reckless" path for when the remote is unreachable or the user accepts the risk. This reverses the
  earlier rule "no --reckless here, ever" in the drop code, so it is a security decision: separate button
  and dialog (never the same click), says plainly that the data may be gone for good if no other copy exists,
  requires typing a confirmation word, never remembered, never used by Get/Save, never default. Fails
  closed on any doubt.

## Constraints
- Windows first: batch the paths so the command line stays under cmd.exe's limit; non-ASCII names; quoting.
- Subjects are nested datasets: get/drop must work on paths inside them (installing a missing subdataset
  without downloading content is fine; the builder checks how DataLad behaves).
- TDD for everything; pure logic (parse, filter, pair, batch) lives in small testable modules.
- Existing trust gate, validation and SECURITY.md must not weaken; paths come from the project listing and
  are validated like current Get/Drop paths.

## Left to the builder
Panel layout and wording (ux-copy rules: plain, few clicks), size source (annex metadata), batching size,
progress display (reuse existing Get progress), how the project listing exposes all names cheaply for
projects with many subjects.

## Calls made by the author after the builder check (not yet reviewed by the user)
1. Pairing on Free up: same-name companions only. Dataset-level and inherited files are never dropped
   (they are shared by the files that stay). Download uses the full pairing set.
2. Reckless drop is offered only after the normal drop was refused or the remote was unreachable, never up
   front. Confirmation word: "delete" (English, case-insensitive, typed). Stops the remaining batches on the
   first failure. Needs a SECURITY.md update and tests for the old "never --reckless" rule that is replaced.
   It does not bypass the trust gate; the project must already be trusted to run any data action.
3. Free up scope is file content only (`--what filecontent`); subdatasets are never uninstalled.
4. Lists come from the subdatasets already installed (a clone with `install -r` installs all of them). A
   subject whose subdataset is missing still shows under Subjects; selecting it installs the subdataset
   without content first (`get -n`), then fetches.
5. The panel shows when the app already detects the project as BIDS (`rootProjectIsBids`).
6. Download counts and lists only files without content; Free up only files with content.
7. Unknown size shows as "size unknown"; the file count is still shown and the action stays allowed.
8. A file that lacks an entity (for example no ses-) does not match when that group is filtered, except the
   dataset-level companions added by the pairing rule.
