# DataLad Desktop

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
- **Branch when you need to**, without it getting in the way when you don't —
  branch management lives in an optional "Project Setup" area.

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

> **Windows:** the installer also checks for Python 3, DataLad, and git-annex and installs any that
> are missing (this needs an internet connection during setup). If a download is blocked by your
> network, install the missing piece manually from [datalad.org](https://www.datalad.org/) — the
> app's diagnostics screen will tell you exactly what's still missing.
>
> **macOS/Linux:** to use DataLad-specific actions (Get Data, Update, Publish) on a project, DataLad
> and git-annex need to be installed on your system. See [datalad.org](https://www.datalad.org/) for
> installation instructions for your platform.

### macOS: "app can't be opened" warning

Release builds aren't signed with an Apple Developer certificate yet, so
Gatekeeper blocks the first launch. **Right-click** (or Control-click)
**DataLad Desktop.app** → **Open** → **Open** in the dialog (if the dialog only
offers "Done", use **System Settings → Privacy & Security → Open Anyway**
instead). Only needed once. Or from a terminal:

```bash
xattr -d com.apple.quarantine "/Applications/DataLad Desktop.app"
```

### Windows: "Windows protected your PC" warning

Installers aren't code-signed yet, so SmartScreen blocks the first run. Click
**More info** → **Run anyway**. Only needed once.

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

These commands work the same in PowerShell, cmd, or a Unix shell — there's nothing macOS/Linux-specific
about running from source.

**Windows notes:**

- Install Python from [python.org](https://www.python.org/) and make sure the **py launcher** option is
  checked. The app looks for `py -3`, then `python`, then `python3`, so the standard Windows Python install
  is detected automatically.
- Install DataLad and git-annex using the Windows installers linked from
  [datalad.org](https://www.datalad.org/) — after installing, open a new terminal so the updated `PATH`
  is picked up before running `npm start`.
- Every push to this repo runs `npm ci`, `npm test`, and a packaging smoke build on `windows-latest` in CI
  (see `.github/workflows/smoke-cross-platform.yml`), so the source install path is continuously checked on
  Windows, not just macOS.

**Run the test suite:**

```bash
npm test
```

**Build your own installer** (output goes to `dist/`):

```bash
npm run package:mac     # macOS
npm run package:win     # Windows
```

### Presetting a studies server for your lab

**Setup → Studies Server (SSH)** lets anyone type in an SSH host and folder
path to browse and install studies from. To preset your lab's own
host/path as the default shown on first open, create an untracked local
override (git-ignored, never committed):

```bash
cp config/studies-server.local.example.json config/studies-server.local.json
```

```json
{
  "host": "myserver.example.org",
  "path": "/data/studies"
}
```

This only supplies the *default* — once someone opens Setup, adds their
username, and clicks Save, their own value takes over.

**Server Type** — two modes:

- **Plain SSH directory** (default): "path" is a folder on the server;
  subfolders are listed via `ssh <host> ls`. Anyone who can SSH in can read
  *and write* every study in the folder — no per-person permission model.
- **Gitolite**: for labs running [Gitolite](https://gitolite.com/gitolite/),
  where per-person, per-repo read/write permissions are managed via SSH key.
  "path" becomes a repo-name prefix (e.g. `mri-lab`), studies are listed via
  `ssh <host> info` (only shows repos that key can access), and the config
  needs `"type": "gitolite"` with a shared service-account host (e.g.
  `git@myserver.example.org`). Cloning/pushing/publishing work unchanged in
  both modes — only listing studies differs.

### Recommended: set up an SSH key instead of a password

The Setup panel's **"Set SSH Password…"** dialog works (kept in memory only,
never written to disk), but a password briefly exists in the environment of
the `ssh`/`datalad`/`git` process — a key avoids that and skips the prompt
every session:

```bash
ssh-keygen -t ed25519 -C "you@example.org"          # if you don't have one
ssh-copy-id -i ~/.ssh/id_ed25519.pub "yourname@studies.example.org"
ssh "yourname@studies.example.org" echo ok          # should print ok, no prompt
```

Use whatever host you type into the app's **Server Host (SSH)** field
(including `user@domain@host` if your login needs it). Once `ssh` connects
without a password, the app authenticates via the key automatically.

## Learn more

- [Roadmap](docs/roadmap.md)
- [Researcher workflow & UX rules](docs/product/researcher-workflow.md)
- [Tutorial pack: progressive research demos](docs/tutorials/README.md)

## License

[MIT](LICENSE)
