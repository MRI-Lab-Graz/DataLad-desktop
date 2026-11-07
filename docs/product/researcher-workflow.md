# Researcher Workflow (MVP)

## Primary user story

A researcher opens Worldline Desktop and selects one of their projects. They review changes, write a commit message, and commit work. Sometimes they create a branch. If file content is missing, they click **Get Data**. If they need remote updates, they click **Update Project**. When done, they click **Publish**.

## UX rules

1. Keep the product center on the project, not the filesystem.
2. Keep one active project at a time.
3. Preserve familiar, standard commit/history/branch workflows (this app is standalone and independent of GitHub Desktop — see `docs/roadmap.md` Phase 6 — "standard" here means conventional Git UX, not GitHub Desktop parity).
4. Show DataLad controls only for DataLad-enabled projects.
5. Keep Git-only projects uncluttered by DataLad-specific UI.
6. Keep language researcher-friendly; avoid annex/sibling internals unless required for recovery.
7. Treat project status as live, not something the user must request: the working-tree view should reflect disk state automatically while a project is open, not only after an explicit refresh click.
8. Do not build a terminal into the app: power users have the terminal. Saves they make there, including recorded `datalad run` commands, show up in Work on this project → History like any other save.

## Project classification in UI

The project card says in plain words what the project check found. DataLad is the normal case and gets no badge; only a plain **Git** folder (no data on demand) or an unknown one does.

A BIDS dataset also gets a **BIDS** badge, and a PRISM project (`project.json` in its root) a **PRISM** badge, each showing **✓ valid** or the number of problems; Save in a PRISM project only goes through when the PRISM validator reports the whole project valid.

## Download only what you need

Large projects do not have to be downloaded as a whole. In the **Files** tab, open **Choose data** (it appears for BIDS projects). Tick what you need, then press **Download selected**:

- **Filters:** subjects, sessions, modalities (anat, func ...), then the parts of the file name (task, acq, run ...), the type (for example T1w or bold) and the file ending. Ticking several values in one filter means "any of these"; different filters narrow each other down. The lists narrow as you tick: after you tick a modality or a subject, a filter only offers values that exist for it (a subject without T2w never shows T2w). A value you already ticked always stays in its list so you can untick it.
- **Nothing ticked means nothing is downloaded.** The panel always shows how many files and how much space your choice takes before you press anything.
- **Matching small files come along.** The side files that belong to a download (the .json next to an image, the events table of a task, bvec/bval files) and the project-wide files (participants.tsv, dataset_description.json) are fetched automatically, if they are stored separately. Files whose names have no `key-value` parts (for example data.csv) do not pull in other files of their own folder (participants.tsv and dataset_description.json still come along when downloading).
- **Download vs. Free up space:** Download copies the chosen files onto this computer. **Free up space** removes your local copy of the chosen files again; the files stay listed and you can download them later. It removes only the files you chose and the files with the same name (for example the .json next to an image) and the matching events file (for example the _events.tsv next to a chosen _bold file); it does not remove participants.tsv or dataset_description.json. It only removes a file when another copy is confirmed (your remote or backup).
- **"Delete without a safety check"** only appears after Free up space was refused for safety, because no other copy could be confirmed. It asks you to type `delete`. If you go on, the data can be **lost for good**. Publish first if you are not sure.
- **Get all not-downloaded** and **Free up space (all)** in the Files tab header do the same for the whole project and only show when they can do something.
- **When something fails, the panel says why.** The note under the buttons gives the reason in plain words (for example that the data source is not set up on this computer yet, or that you do not have access), so you do not have to look for it further down.
- **Empty panel:** if no downloadable files were found, the panel says so in one sentence and the buttons stay off. This can also mean the project was copied without its sub-datasets (see the limitation below).

Known limitation: subject folders that are not set up on this computer yet (a project copied without its sub-datasets) do not appear in the panel, and the panel then cannot tell you they exist. To set them up, either create the project again with **Based on a remote dataset** (this installs the sub-datasets too), or run `datalad get -n -r .` in a terminal inside the project folder (it installs the sub-datasets without downloading any file content). Then press Refresh Files.

## DataLad action surface in MVP

For DataLad-enabled projects, the compact action group should include:

- **Get**, **Free up space** and **Unlock**, on the file and folder rows of the Files tab (Get fetches content; Free up space is its counterpart and only removes data another copy holds, so it only appears when the project has a remote; Get all shows with a remote or when files are missing; Unlock makes an editable copy)
- **Update Project**
- **Publish** (also sends the versions the researcher marked)
- **Add a Remote** (only while the project has none: a USB drive, network share or empty repository)

Alongside these, Work on this project → Branches & Ignore offers **Merge Into Current Branch**; conflicts are resolved per file in the Merge banner. Work on this project → History offers **Mark As Version** and shows recorded `datalad run` commands, and Work on this project → Health offers **Check Data Integrity**. Deliberately not offered: generic command forms, `datalad rerun`, metadata and credential management, container runs. Someone who needs them has the terminal.

Clone/Install should live in onboarding and project-opening flow, not as a permanent toolbar action.

## Guided version-control additions (MVP-safe)

To keep daily scientific version control smooth without adding advanced Git complexity:

1. Show a compact working-tree summary (changed, staged, unstaged, untracked, conflicts).
2. Let users select changed files directly for Save; keep manual path entry as fallback.
3. Keep Save guarded: require a message, warn/block on conflicts, and show a clear post-save summary.
4. Before branch switch/create, check for dirty state and guide users to save first while still allowing an informed continue path when safe.
5. Show a lightweight recent-commit list for quick confidence checks after Save and branch actions.
6. Auto-refresh the working-tree summary and file list when files change on disk (scoped to the active project, debounced), instead of relying on a manual refresh button as the primary mechanism. The watcher should ignore DataLad/git internals (`.git/`, `.datalad/`, `.git/annex/`) and OS noise files, and should pause while a Save/Get/Update/Publish command is in flight so it never races with that command's own status update. Manual refresh remains available as a fallback.
