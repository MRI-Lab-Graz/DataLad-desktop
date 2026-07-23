# Tutorial 1: First checkpoint in a small project

## Scenario

You are a single researcher continuing from Tutorial 00. You now inspect local
changes in the newly created project and save a clean first checkpoint.

## Level

Beginner

## Estimated time

20 to 30 minutes

## Skills trained

- Open an existing project
- Read working-tree status
- Select files for Save
- Write clear Save messages
- Verify a successful checkpoint

## Setup

1. Start from the project created in Tutorial 00.
2. Add project files:
   - `README.md`
   - `data/raw/participants.tsv`
   - `analysis/notebook.ipynb`
3. Make two edits before opening the project view:
   - Add one line to `README.md` describing the pilot aim.
   - Modify one value in `participants.tsv`.
4. Leave one scratch file untracked: `notes/todo.txt`.

## Walkthrough tasks

1. Open the project in DataLad Desktop.
2. Confirm project classification badge (Git, Dataset, or Superdataset).
3. Review changed and untracked files in the working-tree list.
4. Select only research-relevant files for Save.
5. Leave scratch notes unselected.
6. Write a Save message in this format:
   - `pilot: update participant table and project summary`
7. Execute Save.
8. Re-check status to confirm a clean state for selected files.

## Failure injection

- Intentionally include `notes/todo.txt` in Save once.
- Recover by making a second Save that removes the scratch content from tracked
  history according to your project policy.

## Completion criteria

- User can explain why each saved file belongs in history.
- Save completes without conflict warnings.
- Project status reflects expected remaining untracked files.

## Debrief

- What made the Save message useful for future collaborators?
- Which files should stay out of scientific history and why?
