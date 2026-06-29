# Researcher Workflow (MVP)

## Primary user story

A researcher opens DataLad Desktop and selects one of their projects. They review changes, write a commit message, and commit work. Sometimes they create a branch. If file content is missing, they click **Get Data**. If they need remote updates, they click **Update Project**. When done, they click **Publish**.

## UX rules

1. Keep the product center on the project, not the filesystem.
2. Keep one active project at a time.
3. Preserve standard GitHub Desktop commit/history/branch workflows.
4. Show DataLad controls only for DataLad-enabled projects.
5. Keep Git-only projects uncluttered by DataLad-specific UI.
6. Keep language researcher-friendly; avoid annex/sibling internals unless required for recovery.
7. Treat project status as live, not something the user must request: the working-tree view should reflect disk state automatically while a project is open, not only after an explicit refresh click.
8. Keep power-user features opt-in and out of the default view: a "Power user mode" toggle reveals a
   command console (scoped to the active project's folder, no shell, one command per run) for anything the
   curated action set doesn't cover. It runs whatever is typed with no allowlist or GUI safety net — it is
   a real terminal-equivalent, not a guarded action — and stays hidden until explicitly enabled, never
   appearing in the primary novice workflow.

## Project classification in UI

Each active project should display one classification badge:

- **Git**
- **Dataset**
- **Superdataset**

## DataLad action surface in MVP

For DataLad-enabled projects, the compact action group should include:

- **Get Data**
- **Update Project**
- **Publish**

Clone/Install should live in onboarding and project-opening flow, not as a permanent toolbar action.

## Guided version-control additions (MVP-safe)

To keep daily scientific version control smooth without adding advanced Git complexity:

1. Show a compact working-tree summary (changed, staged, unstaged, untracked, conflicts).
2. Let users select changed files directly for Save; keep manual path entry as fallback.
3. Keep Save guarded: require a message, warn/block on conflicts, and show a clear post-save summary.
4. Before branch switch/create, check for dirty state and guide users to save first while still allowing an informed continue path when safe.
5. Show a lightweight recent-commit list for quick confidence checks after Save and branch actions.
6. Auto-refresh the working-tree summary and file list when files change on disk (scoped to the active project, debounced), instead of relying on a manual refresh button as the primary mechanism. The watcher should ignore DataLad/git internals (`.git/`, `.datalad/`, `.git/annex/`) and OS noise files, and should pause while a Save/Get/Update/Publish command is in flight so it never races with that command's own status update. Manual refresh remains available as a fallback.
