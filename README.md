# DataLad Desktop

A desktop app that makes day-to-day data version control approachable for
researchers — no command line required.

## What is DataLad Desktop?

[DataLad](https://www.datalad.org/) is a powerful tool for tracking and
sharing scientific data, built on Git and git-annex. It's great at what it
does, but it's a command-line tool — and most researchers don't want to learn
Git internals just to keep their project's history safe.

DataLad Desktop puts a simple, visual workflow on top of DataLad (and plain
Git projects too): open a project, see what changed, write a short note, and
save a checkpoint. Need data that isn't downloaded yet? One click. Working
across nested sub-projects? The app shows you exactly what changed and where.

## Why use it?

- **See your changes at a glance.** A clear working-tree view shows what's
  new, modified, or missing — including changes inside nested datasets —
  without typing a single Git command.
- **Save checkpoints with confidence.** Pick which files to include, write a
  short message, and save. The app warns you before anything risky (like
  saving over a conflict).
- **Get data on demand.** Large files tracked by git-annex don't have to live
  on your disk until you need them — fetch them with one click.
- **Stay in sync with collaborators.** Update from and publish to a shared
  remote without memorizing remote/branch syntax.
- **Keep noise out of your project history.** Manage `.gitignore` rules (e.g.
  ignoring OS files like `.DS_Store`) for your whole project or just specific
  sub-projects, right from the app.
- **Branch when you need to**, without it getting in the way when you don't —
  branch management lives in an optional, out-of-the-way "Project Setup" area.

## Download & Install

### Recommended: download the app for your OS

Most researchers should just download the ready-to-run app:

1. Go to the [Releases page](https://github.com/MRI-Lab-Graz/DataLad-desktop/releases)
   and download the installer for your system:
   - **macOS:** the `.dmg` file
   - **Windows:** the `.exe` installer
2. Open the downloaded file and follow the install prompts.
3. Launch **DataLad Desktop** like any other app.

That's it — no Git, Python, or DataLad command-line setup needed to get
started with browsing and saving changes in an existing project.

> **Note:** to use DataLad-specific actions (Get Data, Update, Publish) on a
> project, DataLad and git-annex need to be installed on your system. See
> [datalad.org](https://www.datalad.org/) for installation instructions for
> your platform.

### Advanced: install from source

This path is for contributors and advanced users who want to run the app
from the source code instead of an installer.

**Prerequisites:**

- Git
- Node.js 20+ (with npm)
- Python 3.9+
- DataLad
- git-annex

**Clone and run:**

```bash
git clone https://github.com/MRI-Lab-Graz/DataLad-desktop.git
cd DataLad-desktop
npm install
npm start
```

**Run the test suite:**

```bash
npm test
```

**Build your own installer** (output goes to `dist/`):

```bash
npm run package:mac     # macOS
npm run package:win     # Windows
```

## Learn more

- [Roadmap](docs/roadmap.md)
- [Researcher workflow & UX rules](docs/product/researcher-workflow.md)
