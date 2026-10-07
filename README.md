# DataLad Desktop

[![Documentation](https://readthedocs.org/projects/datalad-desktop/badge/?version=latest)](https://datalad-desktop.readthedocs.io/) [**Read the docs →**](https://datalad-desktop.readthedocs.io/)

A stable, easy-to-use, secure version control app for research data — for
macOS, Windows, and Linux, no command line required. DataLad Desktop is its
own independent app, not a fork of or add-on to any other Git client.

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

- **See your changes at a glance** — a working-tree view of what's new,
  modified, or missing, including nested datasets, no Git commands needed.
- **Save checkpoints with confidence** — pick files, write a message, save.
  The app warns you before anything risky (like saving over a conflict).
- **Get data on demand** — large files tracked by git-annex don't have to
  live on your disk until you need them; fetch with one click.
- **Stay in sync with collaborators** — update from and publish to a shared
  remote without memorizing remote/branch syntax.
- **Keep noise out of your history** — manage `.gitignore` rules per project
  or sub-project right from the app.
- **Free up disk space safely** — remove the local copy of downloaded data; the
  app only does it when another copy (your remote or backup) is confirmed.
- **Name the version you cite** — mark a save point as a version (for a paper or
  a release) and Publish sends it along.
- **Check your data is intact** — one click re-checks every downloaded file
  against its checksum.
- **See how a result was made** — commits recorded with `datalad run` show their
  command, inputs and outputs in Time Machine.
- **Keep a second copy** — add a USB drive, network share or an empty GIN/GitHub/
  GitLab repository as a remote in one step.
- **Branch when you need to**, without it getting in the way when you don't —
  branch management lives in an optional "Project Setup" area.
- **Bring branches together** — merge a branch into the one you are on; if the same file changed on both, pick a version per file and finish (or cancel) the merge.

## Download & Install

Download the app for your OS from the [Releases page](https://github.com/MRI-Lab-Graz/DataLad-desktop/releases):
**macOS** `install.sh` (Apple silicon, one Terminal command, no Gatekeeper warning) or the `.dmg`, **Windows** `install.cmd` + `install.ps1` (no admin rights), the installer or the portable
`.exe`, **Linux** `.AppImage`. Release builds aren't code-signed yet, so macOS and Windows show a one-time
warning on first launch.

Everything else — macOS and Windows script installs, the macOS/Windows warnings, first launch (name and email), the
folder trust question, PRISM projects, running from source, network shares — is in the
**[Install guide](https://datalad-desktop.readthedocs.io/en/latest/install.html)**.

## Documentation

**[datalad-desktop.readthedocs.io](https://datalad-desktop.readthedocs.io/)** has the tutorials, researcher
workflow and architecture.

- [Changelog](CHANGELOG.md) · [Security](SECURITY.md) · [Roadmap](docs/roadmap.md)

## License

[MIT](LICENSE)
