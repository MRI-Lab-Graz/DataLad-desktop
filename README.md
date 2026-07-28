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

> **Windows:** the installer also checks for Python 3, DataLad, and git-annex and installs any that
> are missing (this needs an internet connection during setup). If a download is blocked by your
> network, install the missing piece manually from [datalad.org](https://www.datalad.org/) — the
> app's diagnostics screen will tell you exactly what's still missing.
>
> **macOS/Linux:** to use DataLad-specific actions (Get Data, Update, Publish) on a project, DataLad
> and git-annex need to be installed on your system. See [datalad.org](https://www.datalad.org/) for
> installation instructions for your platform.

### macOS: "app can't be opened" warning

Release builds are not yet signed with an Apple Developer certificate, so the
first launch on macOS is blocked by Gatekeeper with a message like *"DataLad
Desktop can't be opened because Apple cannot check it for malicious
software."* This is expected for unsigned apps — you only need to allow it
once:

1. **Right-click** (or Control-click) **DataLad Desktop.app** and choose
   **Open**, then click **Open** in the dialog. On recent macOS versions the
   dialog may only offer "Done" — in that case open
   **System Settings → Privacy & Security**, scroll down to the message about
   DataLad Desktop, and click **Open Anyway**.
2. After that first launch, the app opens normally like any other app.

If you prefer the terminal, this removes the quarantine flag directly:

```bash
xattr -d com.apple.quarantine "/Applications/DataLad Desktop.app"
```

### Windows: "Windows protected your PC" warning

Release builds are not yet signed with a code-signing certificate, so the
installer's first run may be blocked by Microsoft Defender SmartScreen with a
blue screen titled *"Windows protected your PC"*. This is expected for
unsigned installers — you only need to allow it once:

1. On the SmartScreen screen, click **More info**.
2. Click **Run anyway**.
3. The installer proceeds normally, and the installed app opens like any
   other app afterward.

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

The app's **Setup → Studies Server (SSH)** panel lets anyone type in an SSH
host and folder path to browse and install studies from. If your lab runs its
own studies server, you can preset that host/path so it's already filled in
the first time the app is opened (people just add their own username in front
of the host).

Since this repo is public, no lab's real server is committed to source.
Instead, create an untracked local override file:

```bash
cp config/studies-server.local.example.json config/studies-server.local.json
```

Edit `config/studies-server.local.json` with your real values:

```json
{
  "host": "myserver.example.org",
  "path": "/data/studies"
}
```

`config/studies-server.local.json` is git-ignored, so it never leaves your
machine/deployment. It only supplies the *default* shown when no settings
have been saved yet — once someone opens Setup, adds their username, and
clicks Save, their own value takes over from then on.

### Recommended: set up an SSH key instead of a password

The Setup panel has a **"Set SSH Password…"** dialog for studies servers that
require password auth. It works (the password is kept in memory for that
session only, never written to disk), but every password-based SSH login is
inherently less safe than a key: the password briefly exists in the
environment of the `ssh`/`datalad`/`git` process making the connection, which
in principle any other process running as your same OS user could read while
that connection is active. If this is a password you reuse for other logins
too, switching to a key removes that risk entirely — and you'll stop being
asked for a password every session.

**One-time setup, from a terminal (not through the app):**

1. Generate a key if you don't already have one:
   ```bash
   ssh-keygen -t ed25519 -C "you@example.org"
   ```
   Press Enter through the prompts to accept the default location; add a
   passphrase if you want the key itself protected (macOS Keychain/`ssh-agent`
   will remember it after the first unlock).

2. Copy the public key to the studies server — this is the one time you still
   need the password, typed directly into your terminal:
   ```bash
   ssh-copy-id -i ~/.ssh/id_ed25519.pub "yourname@it035016.uni-graz.at"
   ```
   (Replace `yourname@it035016.uni-graz.at` with whatever you type into the
   app's **Server Host (SSH)** field — including the email-style
   `user@domain@host` form if your login needs one; see the field's hint text.)

3. Confirm it works without a password:
   ```bash
   ssh "yourname@it035016.uni-graz.at" echo ok
   ```

Once step 3 prints `ok` with no password prompt, the app's studies-server
connections will authenticate via the key automatically — you can leave the
Setup panel's SSH password unset.

## Learn more

- [Roadmap](docs/roadmap.md)
- [Researcher workflow & UX rules](docs/product/researcher-workflow.md)
- [Tutorial pack: progressive research demos](docs/tutorials/README.md)

## License

[MIT](LICENSE)
