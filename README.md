# DataLad Desktop

DataLad Desktop is a researcher-first desktop app built from GitHub Desktop, adding a small set of DataLad-aware project actions while preserving the familiar project, commit, history, and branch workflow people already understand.

## Product scope (MVP)

The first version keeps the GitHub Desktop shell and exposes only five DataLad actions:

- Clone/Install
- Get
- Save
- Update
- Push

Git-only projects should continue to behave like normal GitHub Desktop projects.

## Platform target

DataLad Desktop must be cross-platform for MVP, with special focus on Windows because the main user base is expected to run on Windows systems.

Platform guidance:

- Windows is the primary day-to-day user platform and should be treated as first-class in UX and validation.
- macOS support remains required for cross-platform parity.
- Cross-platform behavior should stay consistent across project detection, diagnostics, and DataLad actions.

## Installation

The app runs on macOS, Linux, and Windows. For MVP quality and QA depth, Windows and macOS currently have higher priority.

### Prerequisites (all platforms)

- Git
- Node.js 20+ (with npm)
- Python 3.9+
- DataLad
- git-annex

Check what is already installed:

```bash
git --version
node --version
npm --version
python3 --version
datalad --version
git annex version
```

### macOS

Install prerequisites:

```bash
xcode-select --install
brew install git git-annex node@20 python
python3 -m pip install --user datalad
```

If `node` is not on your `PATH` after install, add Homebrew Node:

```bash
echo 'export PATH="$(brew --prefix node@20)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### Linux (Debian/Ubuntu)

Install prerequisites:

```bash
sudo apt update
sudo apt install -y git git-annex python3 python3-pip curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
python3 -m pip install --user datalad
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Windows

Install prerequisites (PowerShell):

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Python.Python.3.12 -e
python -m pip install --user datalad
```

Install git-annex using the official installer/package for Windows:

- https://git-annex.branchable.com/install/windows/

### Install and run DataLad Desktop

```bash
git clone <your-repository-url>
cd DataLad-desktop
npm install
npm start
```

If `npm start` fails with `electron: command not found`, run:

```bash
npm install
```

## Repository setup notes

This repository now includes an initial implementation scaffold for the MVP DataLad adapter boundary, strict command schemas, onboarding diagnostics formatting, and tests for classification edge cases.

Rust port bootstrap is now included for backend migration work:

- Rust core crate: `rust-core/`
- Native Node addon package: `native/rust-core-node/`
- Optional Electron bridge (feature-flagged): `src/datalad/rust-bridge.js`
- Main process fallback logic: `src/gui/main.js`

The Rust adapter path is opt-in and currently disabled by default.

To build the local native Rust module:

```bash
cd native/rust-core-node
npm install
npm run build
```

To enable Rust adapter loading in the app:

```bash
export DATALAD_DESKTOP_USE_RUST_ADAPTER=1
```

The app first tries loading `@datalad-desktop/rust-core` and then falls back to `native/rust-core-node/` for in-repo development. If neither native module is available, it automatically falls back to the JavaScript adapter.

- Roadmap: `docs/roadmap.md`
- Researcher workflow and UX rules: `docs/product/researcher-workflow.md`
- DataLad adapter contract: `docs/architecture/datalad-adapter.md`
- DataLad adapter interface schemas: `docs/architecture/datalad-adapter-interface.md`
- Adapter scaffold source: `src/datalad/adapter.js`
- Adapter tests: `test/adapter.test.js`

## Fork origin and upstream sync

This project is intended to be seeded from GitHub Desktop and maintained with an explicit upstream sync strategy.

- Upstream source repository: _TBD (GitHub Desktop)_
- Upstream starting commit/tag: _TBD_
- Upstream sync strategy: _TBD (document before implementation starts)_

## Local validation

Run baseline tests:

```bash
npm test
```

Rust and bridge validation helpers:

```bash
npm run test:rust:core
npm run test:rust:addon
npm run test:bridge
npm run test:parity
```

## Desktop app testing

Install dependencies and start the desktop app:

```bash
npm install
npm start
```

The window includes:

- Environment diagnostics (with UI-ready recovery report)
- Project classification (Git / Dataset / Superdataset)
- Curated DataLad actions (Clone/Install, Get, Save, Update, Push)
- Adapter interface contract snapshot

## Packaging builds

Build packaged app output into an unpacked directory:

```bash
npm run package:dir
```

Build distributable artifacts:

```bash
npm run package:dist
```

Platform-specific packaging commands:

```bash
npm run package:mac:x64
npm run package:mac:arm64
npm run package:mac:both
npm run package:win:x64
```

Run all requested platform artifacts in sequence:

```bash
npm run package:platforms
```

## GitHub Actions Packaging

Use the workflow [build-os-artifacts.yml](.github/workflows/build-os-artifacts.yml) to build and upload platform artifacts in CI:

- macOS (builds both Intel x64 and Apple Silicon arm64)
- Windows (x64)

Trigger it manually from Actions via **Build OS Artifacts** (`workflow_dispatch`) or automatically by pushing a tag like `v0.1.0`.

When triggered by a `v*` tag, the same workflow also creates a GitHub Release and attaches the generated macOS and Windows artifacts.

## GitLab CI Packaging

Use [.gitlab-ci.yml](.gitlab-ci.yml) to build the same platform artifacts in GitLab CI:

- macOS (builds both Intel x64 and Apple Silicon arm64)
- Windows (x64)

Before the pipeline will run successfully, register runners for both target platforms and tag them to match the CI file:

- `macos`
- `windows`

Those runners should have Node.js 20+ and Rust available on `PATH`, plus whatever local signing/notarization settings you want for release builds. The macOS jobs disable automatic certificate discovery by default, matching the GitHub workflow.

GitLab CI now covers three cases:

- Branch pushes and merge requests run smoke tests plus Rust bridge validation on macOS and Windows.
- Manual pipelines from the GitLab UI run packaging jobs so you can build artifacts on demand.
- `v*` tags build release artifacts and then create a GitLab Release.

Trigger artifact builds either by running a pipeline manually from GitLab (**Build > Pipelines > Run pipeline**) or by pushing a tag like `v0.1.0`.

When triggered by a `v*` tag, the pipeline also creates a GitLab Release with links to the macOS and Windows job artifact archives.

The release job is untagged and uses a container image, so it needs either GitLab shared runners or your own Linux runner with a Docker-capable executor.

If your GitLab runner tags use different names, update the `tags:` entries in [.gitlab-ci.yml](.gitlab-ci.yml) to match your runner registration.

Packaged icons are configured in package.json and use:

- src/gui/assets/icons/datalad_desktop.icns (macOS)
- src/gui/assets/icons/datalad_desktop.ico (Windows)
- src/gui/assets/icons/datalad_desktop.png (Linux)
