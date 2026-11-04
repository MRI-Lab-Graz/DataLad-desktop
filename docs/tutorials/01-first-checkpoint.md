# Tutorial 1: First save in a small project

## Scenario

You are a single researcher continuing from Tutorial 00. You now inspect local
changes in the newly created project and make a clean first save.

**Level:** Beginner · **Time:** 20 to 30 minutes

## Skills trained

- Open an existing project
- Read working-tree status
- Select files for Save
- Write clear Save messages
- Verify a successful save

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
2. Confirm project classification badge next to the project name: **Git**, **DataLad**, or **DataLad + Links**. A project made in Tutorial 00 reads **DataLad**..
3. Review changed and untracked files in the working-tree list.
   Click **Show changes** under a file to see exactly what changed in it before you save.

   ![The Files view, with changed items badged](../_static/screenshots/05-files.png)

4. Every changed file starts ticked. Keep the ticks on the research files
   (`README.md`, `data/raw/participants.tsv`).
5. Untick the scratch note `notes/todo.txt`.
6. Write a Save message in this format:
   - `pilot: update participant table and project summary`

   ![The Save panel: pick files, write a message, save](../_static/screenshots/04-save-checkpoint.png)

7. Execute Save.
8. Re-check the list of changed files. The saved files are gone from it, and
   only `notes/todo.txt` is left. Open **Tools → History** to see your new
   save at the top.

## Failure injection

- Tick `notes/todo.txt` and Save it once, as if by mistake.
- The app saves the file like any other: it is now part of the project's
  history. Open **Tools → History** and select that save to see which files
  it contains. The app has no button that takes one file out of an earlier
  save. To keep scratch files out in future, add a rule in the project's
  ignore rules before they are saved, or leave them unticked as above.

## Completion criteria

- User can explain why each saved file belongs in history.
- Save completes without conflict warnings.
- Project status reflects expected remaining untracked files.

## Debrief

- What made the Save message useful for future collaborators?
- Which files should stay out of scientific history and why?
