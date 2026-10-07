# macOS install script (`install.sh`)

## Problem

The macOS build is unsigned (no Developer ID certificate), so a browser-downloaded `.dmg` or `.zip` carries the
quarantine flag and Gatekeeper warns "app can't be opened". The app also needs git, git-annex and DataLad, which
the `.dmg` does not provide. The Windows script install (`2026-10-05-windows-install-script-design.md`) solved the
same two problems; macOS gets the same treatment. Main goal: **avoid Gatekeeper**. A file fetched with `curl` carries
no quarantine flag, so nothing prompts.

## Decisions

- Apple silicon only. CI builds `package:mac:arm64` only; `install.sh` exits with a clear message on Intel or non-macOS.
  The `.dmg` remains the manual fallback. Intel support (a second CI job) is out of scope.
- Git-annex and DataLad come from **Homebrew** (`brew install git-annex datalad`), not a private uv environment
  (git-annex is not on PyPI).
- If Homebrew is missing, the script offers to run Homebrew's own installer (y/n via `/dev/tty`). With no terminal
  available it prints the official command and exits instead. The Homebrew installer is unpinned and unhashed; this is a
  deliberate trade for a smoother install, recorded in the log.
- Two ways to run the same file: `curl -fsSL <release url>/install.sh | bash`, or download then `bash install.sh`.
- No `uninstall.sh`: the script installs only the app folder and Homebrew packages (documented `rm -rf`).
- Companion app fix (already committed on this branch, 1ca1c05): `src/datalad/resolve-tool.js` also searches
  `/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin` after PATH, because a Finder/Dock launch has a minimal
  PATH. Without it a brew install would not be found by the app.

## Release artifacts (CI)

The macOS job in `build-os-artifacts.yml` additionally renames the unpacked zip to
`DataLad-Desktop-<version>-mac-arm64.zip`, computes its SHA-256, and renders `scripts/macos/install.sh` with
`__VERSION__` and `__ZIP_SHA256__` replaced (`render-install-script.mjs`, generalised to take the template path and to
accept a version/hash pair for either platform). It uploads the zip and `install.sh`. `SHA256SUMS.txt` and the release
globs gain `*.sh`.

## `install.sh` flow

1. **Preflight.** `uname -s` is Darwin and `uname -m` is arm64, else exit with a message.
2. **App.** Download the zip for `__VERSION__` from the tag's release (versioned URL, never `latest`). Refuse to
   continue unless its SHA-256 equals `__ZIP_SHA256__`. Extract to a temp folder next to the target.
3. **Install.** Target `~/Applications/DataLad Desktop.app`, no admin rights. If the app is running, ask the user to
   quit it. An existing copy is renamed `.old`, the new one moved in, `codesign --verify` run; on success `.old` is
   deleted, on failure restored. Then `xattr -dr com.apple.quarantine` on the result (a no-op for `curl`, protects
   `--from-dir` and browser downloads).
4. **Homebrew.** Found via `command -v brew`, then `/opt/homebrew/bin/brew`. If missing: prompt and run its installer, or
   print the command when there is no tty. Then `eval "$(brew shellenv)"` for the rest of the script.
5. **Tools.** `brew install git-annex datalad`, only for what `command -v` does not find.
6. **Verify and report.** Print where `git`, `git-annex`, `datalad` resolve, with versions. Append every step and each
   failing command's output to `~/Library/Logs/DataLad Desktop/install.log`.

Option: `--from-dir <folder>` uses a zip from the same CI run instead of downloading (CI test, local testing). The
hash is still checked.

## Rules (each has a test)

- No `sudo` in the script; the install path is under `$HOME`.
- The zip hash is checked before extraction.
- The download URL is a versioned tag URL, never `latest`.
- Re-running is idempotent (skips present tools, replaces the app safely).
- A failed step leaves the previous install in place.
- The script file is identical for the one-liner and the download path.

## Testing

Tests first, `npm test` (Node runner), in the style of `test/windows-install-script.test.js`:

1. Text-level tests, one per rule above, plus arch/OS preflight and the tty fallback for the Homebrew prompt.
2. Render test: placeholders replaced, invalid version/hash rejected, missing placeholder rejected.
3. Resolver test (done): fallback dirs, PATH wins, none on win32.
4. `install-script-smoke.yml` gains a `macos-latest` job running `install.sh --from-dir` with a zip built in the same
   run, then `codesign --verify`, `datalad --version`, and launching the packaged app (reusing `e2e/packaged.e2e.mjs`).

## Docs

`docs/install.md` gets a macOS section: one-liner first, download-and-read second, uninstall via `rm -rf`.
README stays slim.

## Open points

- `brew install datalad` tracks Homebrew's DataLad version, not a hash-locked one as on Windows. Accepted: Homebrew
  verifies bottle checksums itself.
- Not yet verified from a real Finder launch end to end (only the resolver under a minimal PATH).
