# Tutorial 00: Create your first project

## Scenario

You are starting a brand-new scientific project and want a safe, reproducible
foundation before any data cleaning or analysis.

## Level

Beginner

## Estimated time

15 to 25 minutes

## Skills trained

- Check local tool setup
- Create a new DataLad project from the app
- Confirm project classification and readiness
- Make the first minimal checkpoint

## Setup

1. Choose a path for a new empty folder, for example:
   - `/path/to/projects/pilot-study-001`
2. Keep one short project note ready for first Save:
   - study purpose sentence
   - owner or team name

## Why the empty-folder rule matters

DataLad project creation initializes version-control structure in the target
folder. If that folder already contains files, DataLad cannot safely assume
which existing content belongs to the new project baseline. Starting in an
empty or brand-new folder prevents accidental mixing of unrelated files and
keeps the first checkpoint scientifically auditable.

## Walkthrough tasks

1. In the app header, click **Check Setup**.
2. Confirm Python 3, DataLad, and git-annex report `OK`.
3. In **Create Project**, choose the new folder path.
4. Click **Create Project**.
5. Verify the project opens and classification is Dataset or Superdataset.
6. Add an initial `README.md` line in the project folder.
7. Return to the app, review the changed-file list, and Save with message:
   - `init: create project skeleton and first note`

## Failure injection

- Try creating into a non-empty folder once.
- Confirm the warning and explain what content would have been mixed.
- Recover by selecting an empty folder and repeating creation.

## Completion criteria

- Environment check shows required tools available.
- Project creation succeeds from the app.
- First Save checkpoint exists with a clear intent message.

## Debrief

- Why is project creation inside the app a better first step for new users?
- What lab-wide template content should go into the very first checkpoint?
