# Roadmap: DataLad Desktop

## Vision

DataLad Desktop is a new project, not a continuation of Gooey. It should be a researcher-first desktop application built from a GitHub Desktop fork, with a small and focused DataLad layer. The product center is the project, not the filesystem.

Main workflow:

1. Open a project
2. Inspect changes
3. Commit work
4. Optionally create or switch branch
5. Get data when needed
6. Update from collaborators
7. Publish when ready

## Product principles

- Keep GitHub Desktop as the shell.
- Add DataLad only where it helps researchers.
- Support one active project at a time.
- Keep the first version small.
- Treat Gooey as reference only.
- Keep MVP cross-platform (Windows and macOS), with Windows as the primary user platform for QA and polish priorities.

## MVP command set

- Clone/Install
- Get
- Save
- Update
- Push

Commands that stay in the background for MVP:

- `status`
- `subdatasets`
- `siblings`
- `run`
- metadata commands

## Phase plan

### Phase 0: New repository

- Create a new repository named `datalad-desktop`.
- Decide visible fork vs fresh repo seeded from upstream code.
- Record exact upstream GitHub Desktop commit/tag used.
- Define upstream-sync strategy from the beginning.
- Replace GitHub trademarks/logos/product wording with original DataLad Desktop branding.

### Phase 1: Fork baseline

- Build and run unmodified GitHub Desktop baseline locally.
- Confirm Windows and macOS development setup.
- Preserve core shell areas:
  - changes view
  - commit UI
  - history
  - branch workflows
  - project list
  - startup restore
- Keep a clear product statement in this repository.

### Phase 2: DataLad foundation

- Add project classification:
  - plain Git repository
  - DataLad dataset
  - DataLad superdataset
- Add one thin DataLad adapter boundary responsible for:
  - environment checks
  - project detection
  - curated command execution
  - structured results
  - progress reporting
  - user-friendly error mapping
- Do not scatter shell calls through UI code.
- Add environment diagnostics for missing Python, DataLad, git-annex, or unsupported system state.

### Phase 3: Researcher MVP

- Keep normal GitHub Desktop commit flow.
- Route commit action through `datalad save` for DataLad-enabled projects when appropriate.
- Add project badge: Git / Dataset / Superdataset.
- Add compact DataLad action group:
  - Get Data
  - Update Project
  - Publish
- Put Clone/Install in project onboarding flow (not a persistent toolbar action).
- Make missing-content states understandable and route users to Get Data.
- Keep branch creation/switching as standard GitHub Desktop behavior.

### Phase 4: Project rules

- Active project is the top-level dataset or superdataset intentionally opened by the user.
- Subdatasets are project structure, not implicit project switches.
- Git-only projects behave as normal GitHub Desktop projects.
- DataLad UI appears only when project classification requires it.
- Normal flow should never force users to choose between `git commit` and `datalad save`.

### Phase 5: UX polish

- Make onboarding clear:
  - open existing project
  - clone DataLad project
  - reopen recent project
- Make update/publish failures understandable:
  - missing remote
  - missing credentials
  - missing DataLad tooling
  - unsupported configuration
- Keep error language researcher-friendly unless technical details are necessary for recovery.
- Validate that app still feels like GitHub Desktop, not Gooey with a skin.

### Phase 6: Packaging and release

- Build native packaging for the new Electron-based repository.
- Reuse Gooey installer lessons only as reference.
- Validate Windows and macOS installers early.
- Add CI for build, test, packaging, and release automation.
- Confirm branding is fully original before public release.

## Definition of MVP done

- A researcher can open a project and immediately see whether it is Git-only or DataLad-enabled.
- The app preserves standard GitHub Desktop experience for changes, commit flow, history, and branches.
- Get Data, Update Project, and Publish work for DataLad projects.
- Normal commit flow works for DataLad projects through a DataLad-aware save path.
- Git-only projects remain clean and uncluttered.
- Windows and macOS builds launch and complete the main researcher workflow.

## Explicit non-goals (MVP)

- Generic DataLad command forms
- Filesystem-first browsing as the main app model
- Full metadata editing
- Raw sibling-management UI
- Reproducible execution workflows (`run`)
- A broad command catalog mirroring full DataLad CLI
