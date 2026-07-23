# Tutorial 2: Data cleaning and metadata discipline

## Scenario

A researcher is cleaning incoming tabular data and updating metadata. The goal
is to separate data cleaning from analysis edits and preserve traceability.

## Level

Beginner to intermediate

## Estimated time

30 to 40 minutes

## Skills trained

- Plan focused Save checkpoints
- Separate data edits from code edits
- Use meaningful commit note prefixes
- Verify status after each Save

## Setup

1. Start from Tutorial 1 completion state.
2. Introduce these pending changes:
   - `data/raw/participants.tsv`: fix missing values.
   - `data/clean/participants_clean.tsv`: new cleaned table.
   - `metadata/data-dictionary.md`: add variable descriptions.
   - `analysis/notebook.ipynb`: minor exploratory cell edit.

## Walkthrough tasks

1. Open project and review all pending changes.
2. Create Save checkpoint 1 containing only data and metadata edits.
3. Use Save message:
   - `cleaning: normalize participant table and update dictionary`
4. Verify notebook changes are still unsaved.
5. Create Save checkpoint 2 containing only notebook edits.
6. Use Save message:
   - `analysis: exploratory cell update after cleaning`
7. Confirm there are no accidental cross-topic changes in either checkpoint.

## Failure injection

- Intentionally mix one notebook file into checkpoint 1.
- Recover by documenting why mixed checkpoints reduce reproducibility and redo
  the split using additional Save checkpoints.

## Completion criteria

- Data provenance and analysis provenance are separated.
- Messages clearly describe scientific intent.
- Working-tree status is consistent with expected file grouping.

## Debrief

- How does checkpoint scope affect peer review and replication?
- What naming convention will your lab use for Save messages?
