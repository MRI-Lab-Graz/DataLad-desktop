# Worldline Desktop

[![Documentation](https://readthedocs.org/projects/datalad-desktop/badge/?version=latest)](https://datalad-desktop.readthedocs.io/) [**Read the docs →**](https://datalad-desktop.readthedocs.io/)

A stable, easy-to-use, secure version control app for research data — for
macOS, Windows, and Linux, no command line required. Worldline Desktop is its
own independent app, not a fork of or add-on to any other Git client.

Worldline Desktop is an independent project. It is not affiliated with or endorsed by the DataLad project; it simply works
with DataLad datasets.

## What is Worldline Desktop?

[DataLad](https://www.datalad.org/) is a powerful tool for tracking and
sharing scientific data, built on Git and git-annex. It's great at what it
does, but it's a command-line tool — and most researchers don't want to learn
Git internals just to keep their project's history safe.

Worldline Desktop puts a simple, visual workflow on top of DataLad (and plain
Git projects too): open a project, see what changed, write a short note, and
save. Need data that isn't downloaded yet? One click. Working
across nested sub-projects? The app shows you exactly what changed and where.

## Why use it?

- **See your changes at a glance** — a working-tree view of what's new,
  modified, or missing, including nested datasets, no Git commands needed.
- **Save with confidence** — pick files, write a message, save. One Save covers nested datasets too, so the whole project ends up saved and clean.
  The app warns you before anything risky (like saving over a conflict).
- **See what changed** — one click under a changed file shows exactly which lines (for tables: which cells) changed; Tools → History can compare any earlier save with your files now.
- **Record how a result was made** — Tools → History → Run & record: type the command and its inputs and outputs, and DataLad saves the result together with the exact command, so anyone can repeat it.
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
  command, inputs and outputs in Tools → History.
- **Keep a second copy** — add a USB drive, network share or an empty GIN/GitHub/
  GitLab repository as a remote in one step.
- **Branch when you need to**, without it getting in the way when you don't —
  branch management lives under Tools → Branches & Ignore.
- **Bring branches together** — merge a branch into the one you are on; if the same file changed on both, pick a version per file and finish (or cancel) the merge.

## Download & Install

Download the app for your OS from the [Releases page](https://github.com/MRI-Lab-Graz/DataLad-desktop/releases):
**Windows** `windows-install.cmd` (one file, no admin rights), **macOS** `macos-install.sh` (Apple silicon, one Terminal command, no Gatekeeper warning), **Linux** `linux-install.sh`. The scripts check the app against a SHA-256 written into the script, so the
unsigned builds need no click-through warning.

Everything else — macOS and Windows script installs, first launch (name and email), the
folder trust question, PRISM projects, running from source, network shares — is in the
**[Install guide](https://datalad-desktop.readthedocs.io/en/latest/install.html)**.

The app tells you when DataLad or git-annex have a newer version (it never installs those). If you installed the PRISM validator, the app also keeps it up to date in the background, using only releases that are at least 3 days old. Administrators can turn all of this off, see [SECURITY.md](SECURITY.md).

## Documentation

**[datalad-desktop.readthedocs.io](https://datalad-desktop.readthedocs.io/)** has the tutorials, researcher
workflow and architecture.

- [Changelog](CHANGELOG.md) · [Security](SECURITY.md) · [Roadmap](docs/roadmap.md)

## Check the manual still works

`npm run walkthrough` plays tutorials 00 and 01 in the real app, like a first-time student, and runs a few accessibility checks (dialog focus, screen-reader announcements, colour contrast). It needs Node 22 or newer (for `node --test` glob expansion; the same holds for
`npm run test:e2e`), this repo, `npm install`, and DataLad + git-annex on your PATH. It works in a throwaway folder with a throwaway
git identity, so your own settings and projects are never touched, and it prints one line per step.

- A failed step saves a screenshot to `walkthrough-failures/` (git-ignored).
- A step marked "todo" is a known app bug the walkthrough records. It is not a failure of the run.
- `DLAD_APP_EXECUTABLE=<path to the packaged app> npm run walkthrough` tests a built app instead of the
  source. The app always asks for a native confirmation before creating a project in a new folder, and a
  script cannot click that, so the project-creation steps are skipped for a packaged app. On PowerShell:
  `$env:DLAD_APP_EXECUTABLE="C:\path\Worldline Desktop.exe"; npm run walkthrough`
- Tutorials 02-06 are not covered yet. `npm test` fails when a new tutorial is added without a walkthrough
  or an explicit "not covered" entry.

## License

[MIT](LICENSE)
