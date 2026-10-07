# macOS install script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `install.sh` with each release so a Mac user installs DataLad Desktop, git-annex and DataLad from one Terminal command, with no Gatekeeper prompt.

**Architecture:** CI zips the arm64 app with `ditto`, renders `scripts/macos/install.sh` with the version and the zip's SHA-256 (reusing `render-install-script.mjs`), and uploads both. The script downloads the tag's zip with `curl` (no quarantine flag), verifies the hash, swaps the app into `~/Applications`, installs Homebrew if missing (asked first), and `brew install`s whatever of git-annex/datalad is missing.

**Tech Stack:** bash 3.2 (macOS default), `ditto`, `codesign`, `shasum`, Homebrew; Node test runner; GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-07-macos-install-script-design.md`

## Global Constraints

- Apple silicon only: preflight exits unless `uname -s` is `Darwin` and `uname -m` is `arm64`.
- No `sudo` in the script; everything installs under `$HOME`.
- The zip's SHA-256 is checked before extraction; the download URL is a versioned tag URL, never `latest`.
- Bash 3.2 compatible (no associative arrays, no `${v,,}`), and safe under `curl | bash`: the whole script lives in a `main` function called on the last line, and child commands read `/dev/null` for stdin.
- Placeholders `__VERSION__` and `__ZIP_SHA256__` appear in the template exactly once each (the renderer replaces every occurrence).
- Zero new npm dependencies (Node built-ins only). TDD: failing test first, `npm test` to run.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Unrendered template (placeholders still in): script must refuse, not try to download `v__VERSION__`.
- Hash mismatch: nothing is extracted, nothing under `~/Applications` is touched, exit is non-zero.
- Intel Mac or Linux: clear message, exit non-zero, before any download or log directory.
- App is running during an upgrade: refuse with a "quit it first" message, previous install untouched.
- `curl | bash` with a child command that reads stdin (brew): the rest of the script must not be swallowed.
- Re-run on a machine that already has everything: no `brew install`, no Homebrew prompt, app replaced safely.

---

### Task 1: Renderer accepts a template path

**Files:**
- Modify: `scripts/render-install-script.mjs` (the `main` function, last 8 lines)
- Test: `test/render-install-script.test.js`

**Interfaces:**
- Produces: CLI `node scripts/render-install-script.mjs <version> <zip> <out> [template]`; `template` defaults to `scripts/windows/install.ps1`. `renderInstallScript` is unchanged and is reused for `.sh`.

- [ ] **Step 1: Write the failing test** (append to `test/render-install-script.test.js`)

```js
test('the CLI renders a template given as the 4th argument', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dlad-render-'))
  const zip = join(dir, 'app.zip')
  const tpl = join(dir, 'tpl.sh')
  const out = join(dir, 'install.sh')
  await writeFile(zip, 'zip bytes')
  await writeFile(tpl, "V='__VERSION__'\nH='__ZIP_SHA256__'\n")
  execFileSync(process.execPath, ['scripts/render-install-script.mjs', '1.0.0', zip, out, tpl], { cwd: new URL('..', import.meta.url) })
  const expected = createHash('sha256').update('zip bytes').digest('hex').toUpperCase()
  assert.equal(await readFile(out, 'utf8'), `V='1.0.0'\nH='${expected}'\n`)
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test test/render-install-script.test.js`
Expected: the new test fails (the CLI renders the Windows template and ignores the 4th argument, so the output differs).

- [ ] **Step 3: Implement** — in `main`, take an optional 4th argument:

```js
async function main([version, zipPath, outPath, templatePath]) {
  if (!version || !zipPath || !outPath) {
    throw new Error('Usage: node scripts/render-install-script.mjs <version> <zip> <out> [template]')
  }
  const template = await readFile(templatePath ?? new URL('./windows/install.ps1', import.meta.url), 'utf8')
  await writeFile(outPath, renderInstallScript(template, { version, zipSha256: await sha256OfFile(zipPath) }))
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `node --test test/render-install-script.test.js` → all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/render-install-script.mjs test/render-install-script.test.js
git commit -m "feat: render-install-script takes an optional template path"
```

---

### Task 2: `install.sh`

**Files:**
- Create: `scripts/macos/install.sh`
- Test: `test/macos-install-script.test.js`

**Interfaces:**
- Consumes: `renderInstallScript(template, { version, zipSha256 })` from Task 1's module.
- Produces: `scripts/macos/install.sh` with placeholders `__VERSION__`, `__ZIP_SHA256__`; option `--from-dir <folder>` (zip named `DataLad-Desktop-<version>-mac-arm64.zip` inside it); app lands at `$HOME/Applications/DataLad Desktop.app`; log at `$HOME/Library/Logs/DataLad Desktop/install.log`.

- [ ] **Step 1: Write the failing tests** — create `test/macos-install-script.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, chmod, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderInstallScript } from '../scripts/render-install-script.mjs'

const path = new URL('../scripts/macos/install.sh', import.meta.url).pathname
const sh = await readFile(path, 'utf8')
const HASH = '0'.repeat(64)

// A PATH folder whose uname answers like an Apple-silicon Mac (or whatever the test says).
async function fakeUname(system, machine) {
  const dir = await mkdtemp(join(tmpdir(), 'dlad-uname-'))
  const f = join(dir, 'uname')
  await writeFile(f, `#!/bin/sh\ncase "$1" in -s) echo ${system};; -m) echo ${machine};; esac\n`)
  await chmod(f, 0o755)
  return dir
}

async function run(script, args, { system = 'Darwin', machine = 'arm64' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dlad-run-'))
  const file = join(dir, 'install.sh')
  await writeFile(file, script)
  const home = join(dir, 'home')
  await mkdir(home)
  const r = spawnSync('/bin/bash', [file, ...args], {
    env: { HOME: home, PATH: `${await fakeUname(system, machine)}:${process.env.PATH}` },
    encoding: 'utf8'
  })
  return { ...r, home, out: `${r.stdout}${r.stderr}` }
}

test('install.sh is valid bash', () => {
  execFileSync('bash', ['-n', path])
})

test('the template has each placeholder exactly once', () => {
  assert.equal(sh.split('__VERSION__').length - 1, 1)
  assert.equal(sh.split('__ZIP_SHA256__').length - 1, 1)
})

// A repo checkout is a template: it must not try to download v__VERSION__.
test('an unrendered template refuses to run', async () => {
  const r = await run(sh, [])
  assert.notEqual(r.status, 0)
  assert.match(r.out, /template/i)
})

test('exits before doing anything on an Intel Mac or on Linux', async () => {
  const script = renderInstallScript(sh, { version: '9.9.9', zipSha256: HASH })
  for (const [system, machine] of [['Darwin', 'x86_64'], ['Linux', 'arm64']]) {
    const r = await run(script, [], { system, machine })
    assert.notEqual(r.status, 0, `${system} ${machine}`)
    assert.match(r.out, /Apple silicon/i)
    assert.deepEqual(await readdir(r.home), [], 'preflight must not create anything')
  }
})

test('a zip whose SHA-256 does not match is refused and nothing is installed', async () => {
  const from = await mkdtemp(join(tmpdir(), 'dlad-from-'))
  await writeFile(join(from, 'DataLad-Desktop-9.9.9-mac-arm64.zip'), 'not the real app')
  const r = await run(renderInstallScript(sh, { version: '9.9.9', zipSha256: HASH }), ['--from-dir', from])
  assert.notEqual(r.status, 0)
  assert.match(r.out, /SHA-256/)
  assert.deepEqual(await readdir(join(r.home, 'Applications')).catch(() => []), [], 'no app, no temp folder left behind')
})

test('an unknown option is an error', async () => {
  const r = await run(renderInstallScript(sh, { version: '9.9.9', zipSha256: HASH }), ['--bogus'])
  assert.notEqual(r.status, 0)
  assert.match(r.out, /--bogus/)
})

// Text-level rules from the spec.
test('never uses sudo and installs only under $HOME', () => {
  assert.doesNotMatch(sh, /\bsudo\b/)
  assert.match(sh, /APP_DIR="\$HOME\/Applications"/)
  assert.doesNotMatch(sh, /["\s]\/Applications\b/)
})

test('downloads a versioned tag URL, never latest', () => {
  assert.match(sh, /releases\/download\/v\$\{APP_VERSION\}\//)
  assert.doesNotMatch(sh, /releases\/latest/)
})

test('checks the zip hash before extracting it', () => {
  const check = sh.indexOf('check_hash "$zip"')
  const extract = sh.indexOf('ditto -x -k')
  assert.ok(check !== -1 && extract > check)
})

test('only installs tools that are missing', () => {
  assert.match(sh, /command -v git-annex/)
  assert.match(sh, /command -v datalad/)
})

test('offers Homebrew through /dev/tty and prints the official command when there is no terminal', () => {
  assert.match(sh, /<\/dev\/tty/)
  assert.ok(sh.includes('https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh'))
  assert.match(sh, /no terminal/i)
})

// Under `curl | bash` the shell reads the script from stdin: a child that reads stdin would swallow the rest.
test('runs inside main on the last line and gives brew no stdin', () => {
  const last = sh.trimEnd().split('\n').pop()
  assert.equal(last, 'main "$@"')
  assert.match(sh, /brew install [^\n]*<\/dev\/null/)
})

test('keeps the previous app until the new one passes codesign, and restores it on failure', () => {
  assert.match(sh, /\.old/)
  assert.match(sh, /codesign --verify/)
})

test('asks the user to quit a running app', () => {
  assert.match(sh, /pgrep/)
})

test('removes the quarantine flag from the installed app', () => {
  assert.match(sh, /xattr -dr com\.apple\.quarantine/)
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test test/macos-install-script.test.js`
Expected: FAIL (`ENOENT … install.sh`).

- [ ] **Step 3: Write `scripts/macos/install.sh`**

```bash
#!/bin/bash
# Installs DataLad Desktop for the current user (Apple silicon). No administrator rights needed for this script.
#
# Run it with:   curl -fsSL https://github.com/MRI-Lab-Graz/DataLad-desktop/releases/download/v<version>/install.sh | bash
# or download it and run:   bash install.sh
# The copy attached to a GitHub release has the version and the SHA-256 of that release's app zip filled in by CI.
# The copy in the repository is a template and refuses to run.
#
# Options:
#   --from-dir <folder>   take the zip from that folder (named as on the release page) instead of downloading it;
#                         its SHA-256 is still checked

# Everything lives in main, called on the last line: with `curl | bash` the shell reads this file from stdin, so it has
# to be parsed completely before any command that might read stdin runs.
main() {
    set -euo pipefail

    # ---- Pins ----
    local APP_VERSION='__VERSION__'
    local APP_ZIP_SHA256='__ZIP_SHA256__'
    local REPO='MRI-Lab-Graz/DataLad-desktop'
    local APP_ZIP_NAME="DataLad-Desktop-${APP_VERSION}-mac-arm64.zip"
    local APP_ZIP_URL="https://github.com/${REPO}/releases/download/v${APP_VERSION}/${APP_ZIP_NAME}"
    local BREW_INSTALL_URL='https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh'
    local APP_NAME='DataLad Desktop.app'
    local APP_DIR="$HOME/Applications"
    local LOG_DIR="$HOME/Library/Logs/DataLad Desktop"
    local from_dir=''

    die() { echo "ERROR: $*" >&2; exit 1; }
    log() { echo "==> $*"; }

    while [ $# -gt 0 ]; do
        case "$1" in
            --from-dir) [ $# -ge 2 ] || die '--from-dir needs a folder'; from_dir="$2"; shift 2 ;;
            *) die "Unknown option: $1" ;;
        esac
    done

    case "$APP_VERSION" in
        __*) die 'This is the repository template, not a release copy. Use the install.sh attached to a release.' ;;
    esac
    [ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] ||
        die 'This installer supports Macs with Apple silicon only. Intel Macs: use the .dmg from the release page.'

    mkdir -p "$LOG_DIR"
    exec > >(tee -a "$LOG_DIR/install.log") 2>&1
    log "DataLad Desktop $APP_VERSION"

    check_hash() {
        local actual
        actual=$(shasum -a 256 "$1" | awk '{print toupper($1)}')
        [ "$actual" = "$APP_ZIP_SHA256" ] || die "SHA-256 of $(basename "$1") does not match this release ($actual). Nothing was installed."
    }

    install_app() {
        local target="$APP_DIR/$APP_NAME" old="$APP_DIR/$APP_NAME.old" work zip
        if pgrep -f "$APP_NAME/Contents/MacOS" >/dev/null 2>&1; then
            die 'DataLad Desktop is running. Quit it and run this installer again.'
        fi
        mkdir -p "$APP_DIR"
        work=$(mktemp -d "$APP_DIR/.install.XXXXXX")
        trap "rm -rf '$work'" EXIT   # expanded now: $work is local and gone when the trap fires
        if [ -n "$from_dir" ]; then
            zip="$from_dir/$APP_ZIP_NAME"
            [ -f "$zip" ] || die "$zip not found"
        else
            zip="$work/$APP_ZIP_NAME"
            log "Downloading $APP_ZIP_URL"
            curl -fsSL --retry 3 -o "$zip" "$APP_ZIP_URL" || die "Download failed: $APP_ZIP_URL"
        fi
        check_hash "$zip"
        ditto -x -k "$zip" "$work/x"
        [ -d "$work/x/$APP_NAME" ] || die "The zip has no $APP_NAME at its root."
        if [ -e "$target" ]; then
            rm -rf "$old"
            mv "$target" "$old"
        fi
        mv "$work/x/$APP_NAME" "$target"
        if ! codesign --verify --deep --strict "$target"; then
            rm -rf "$target"
            [ -e "$old" ] && mv "$old" "$target"
            die 'The new app failed codesign verification; the previous install was restored.'
        fi
        rm -rf "$old"
        xattr -dr com.apple.quarantine "$target" 2>/dev/null || true
        log "Installed $target"
    }

    find_brew() {
        command -v brew >/dev/null 2>&1 && return 0
        if [ -x /opt/homebrew/bin/brew ]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
            return 0
        fi
        return 1
    }

    ensure_brew() {
        find_brew && return 0
        local cmd="/bin/bash -c \"\$(curl -fsSL $BREW_INSTALL_URL)\""
        if ! { : </dev/tty; } 2>/dev/null; then
            die "Homebrew is not installed and there is no terminal to ask you. Install it with:  $cmd  then run this installer again."
        fi
        printf 'Homebrew is not installed. It provides git-annex and DataLad. Install it now? [y/N] ' >/dev/tty
        local answer
        read -r answer </dev/tty || answer=n
        case "$answer" in
            [yY]*) log 'Running the Homebrew installer (not pinned or hash-checked by us)'
                   /bin/bash -c "$(curl -fsSL "$BREW_INSTALL_URL")" </dev/tty ;;
            *) die "Homebrew is needed. Install it with:  $cmd  then run this installer again." ;;
        esac
        find_brew || die 'Homebrew was installed but brew was not found. Open a new Terminal and run this installer again.'
    }

    install_tools() {
        local missing=''
        command -v git-annex >/dev/null 2>&1 || missing="$missing git-annex"
        command -v datalad >/dev/null 2>&1 || missing="$missing datalad"
        if [ -z "$missing" ]; then
            log 'git-annex and datalad are already installed'
            return 0
        fi
        ensure_brew
        log "brew install$missing"
        # shellcheck disable=SC2086  # word splitting of the package list is intended
        brew install $missing </dev/null
    }

    install_app
    git --version >/dev/null 2>&1 || die 'git is missing. Run  xcode-select --install  and run this installer again.'
    install_tools

    log 'Installed tools:'
    local tool
    for tool in git git-annex datalad; do
        printf '  %s -> %s\n' "$tool" "$(command -v "$tool" || echo 'NOT FOUND')"
    done
    command -v datalad >/dev/null 2>&1 && datalad --version
    log "Done. Open $APP_DIR/$APP_NAME. Log: $LOG_DIR/install.log"
}

main "$@"
```

- [ ] **Step 4: Run, expect PASS**

Run: `node --test test/macos-install-script.test.js` → all pass. Then `npm test` → full suite green.
If the intel/Linux test shows leftover files in `$HOME`, the preflight ran after `mkdir`; keep `mkdir` after the arch check as written.

- [ ] **Step 5: Commit**

```bash
git add scripts/macos/install.sh test/macos-install-script.test.js
git commit -m "feat: macOS install script (app zip with SHA-256 check, Homebrew for git-annex and DataLad)"
```

---

### Task 3: Release job builds, renders and ships install.sh

**Files:**
- Modify: `.github/workflows/build-os-artifacts.yml` (macos job: new step before "Upload macOS artifacts" and two upload paths; publish job: `sha256sum` line, attest list, release list)
- Test: `test/macos-install-script-release.test.js`

**Interfaces:**
- Consumes: Task 1 CLI with the template argument; Task 2's `scripts/macos/install.sh`.
- Produces: release assets `DataLad-Desktop-<version>-mac-arm64.zip` and `install.sh`, covered by `SHA256SUMS.txt` and the attestation.

- [ ] **Step 1: Write the failing test** — create `test/macos-install-script-release.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const release = await readFile(new URL('../.github/workflows/build-os-artifacts.yml', import.meta.url), 'utf8')
const macJob = release.slice(release.indexOf('  macos:'), release.indexOf('  windows:'))
const publishJob = release.slice(release.indexOf('  publish-release:'))

test('the macOS job zips the app with ditto, then renders install.sh from that zip', () => {
  const zip = macJob.indexOf('ditto -c -k --keepParent')
  const render = macJob.indexOf('node scripts/render-install-script.mjs')
  assert.ok(zip !== -1 && render > zip)
  assert.ok(macJob.includes('DataLad-Desktop-$version-mac-arm64.zip'))
  assert.ok(macJob.includes('scripts/macos/install.sh'))
})

test('a release tag must equal the package version, because the script downloads from the tag', () => {
  assert.match(macJob, /refs\/tags\/v\$version/)
})

test('the macOS artifact carries the arm64 zip and install.sh', () => {
  const upload = macJob.slice(macJob.indexOf('name: datalad-desktop-macos'))
  for (const p of ['dist/DataLad-Desktop-*-mac-arm64.zip', 'dist/install.sh']) {
    assert.ok(upload.includes(p), `artifact does not include ${p}`)
  }
})

test('SHA256SUMS, the attestation and the release files cover install.sh', () => {
  assert.match(publishJob, /sha256sum [^\n]*\*\.sh/)
  assert.equal(publishJob.split('release-assets/*.sh').length - 1, 2)
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test test/macos-install-script-release.test.js` → all four fail.

- [ ] **Step 3: Edit the workflow**

Insert in the `macos` job directly before `- name: Upload macOS artifacts`:

```yaml
      # The script install (scripts/macos/install.sh) downloads this zip from the tag's release and checks it
      # against the SHA-256 rendered into its own copy of the script, so the tag has to match the package version.
      # ditto keeps the code signature and symlinks intact, which a plain zip would not.
      - name: Zip the app and render the install script
        run: |
          version=$(node -p "require('./package.json').version")
          if [[ "$GITHUB_REF" == refs/tags/v* && "$GITHUB_REF" != "refs/tags/v$version" ]]; then
            echo "::error::Tag $GITHUB_REF does not match the package.json version $version"
            exit 1
          fi
          zip="dist/DataLad-Desktop-$version-mac-arm64.zip"
          ditto -c -k --keepParent "dist/mac-arm64/DataLad Desktop.app" "$zip"
          node scripts/render-install-script.mjs "$version" "$zip" dist/install.sh scripts/macos/install.sh
```

Add `dist/DataLad-Desktop-*-mac-arm64.zip` and `dist/install.sh` to that job's upload `path:` list (below `dist/*-mac.zip`).

In `publish-release`: change `sha256sum *.dmg *.zip *.exe *.AppImage *.cmd *.ps1` to end with `*.cmd *.ps1 *.sh`; add `release-assets/*.sh` after `release-assets/*.ps1` in both the attestation `subject-path` and the release `files`.

- [ ] **Step 4: Run, expect PASS**

Run: `node --test test/macos-install-script-release.test.js test/install-script-release.test.js` → all pass (the Windows release test must still pass). Then `npm test`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/build-os-artifacts.yml test/macos-install-script-release.test.js
git commit -m "ci: ship the macOS app zip and a rendered install.sh with each release"
```

---

### Task 4: CI smoke job that really runs install.sh

**Files:**
- Modify: `.github/workflows/install-script-smoke.yml` (rename workflow, add job)
- Modify: `test/install-script-smoke-workflow.test.js` (add tests; keep the existing Windows ones)

**Interfaces:**
- Consumes: `scripts/macos/install.sh --from-dir`, the render CLI.

- [ ] **Step 1: Write the failing tests** (append to `test/install-script-smoke-workflow.test.js`)

```js
const macJob = workflow.slice(workflow.indexOf('  install-script-macos:'))

test('the macOS job starts from a runner with no DataLad or git-annex pre-installed and runs install.sh --from-dir', () => {
  assert.ok(macJob.length > 0, 'no install-script-macos job')
  assert.match(macJob, /runs-on: macos-latest/)
  assert.doesNotMatch(macJob, /brew install/)
  const order = [
    'node scripts/fetch-uv.mjs aarch64-apple-darwin',
    'electron-builder --mac dir --arm64',
    'ditto -c -k --keepParent',
    'node scripts/render-install-script.mjs',
    'bash "$RUNNER_TEMP/release/install.sh" --from-dir'
  ]
  let at = -1
  for (const step of order) {
    const next = macJob.indexOf(step, at + 1)
    assert.ok(next > at, `expected "${step}" after the previous step`)
    at = next
  }
})

test('the macOS job checks the installed app, the tools and the packaged app', () => {
  assert.match(macJob, /codesign --verify/)
  assert.match(macJob, /datalad --version/)
  assert.match(macJob, /DLAD_APP_EXECUTABLE/)
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test test/install-script-smoke-workflow.test.js` → the two new tests fail.

- [ ] **Step 3: Edit the workflow** — change `name:` to `Install Script Smoke`, update the header comment to mention `install.sh`, and append the job (same pinned action SHAs as the Windows job):

```yaml
  install-script-macos:
    name: install.sh (macos-latest)
    runs-on: macos-latest
    timeout-minutes: 40

    steps:
      - name: Checkout
        uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5

      - name: Setup Node
        uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5
        with:
          node-version: '22'
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Fetch bundled uv
        run: node scripts/fetch-uv.mjs aarch64-apple-darwin

      # Deliberately NOT installing DataLad or git-annex here: the script has to provide them.
      - name: Build the unpacked app
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'
        run: npx electron-builder --mac dir --arm64 --publish never

      # The same zip and rendering as the release job, into a folder the script reads with --from-dir.
      - name: Zip the app and render the install script
        run: |
          version=$(node -p "require('./package.json').version")
          out="$RUNNER_TEMP/release"
          mkdir -p "$out"
          zip="$out/DataLad-Desktop-$version-mac-arm64.zip"
          ditto -c -k --keepParent "dist/mac-arm64/DataLad Desktop.app" "$zip"
          node scripts/render-install-script.mjs "$version" "$zip" "$out/install.sh" scripts/macos/install.sh

      # No terminal on the runner: Homebrew is already there, so the prompt is never reached.
      - name: Install with install.sh
        timeout-minutes: 25
        run: bash "$RUNNER_TEMP/release/install.sh" --from-dir "$RUNNER_TEMP/release" < /dev/null

      - name: Script left a verified app and working tools
        run: |
          codesign --verify --deep --strict "$HOME/Applications/DataLad Desktop.app"
          xattr "$HOME/Applications/DataLad Desktop.app" | grep -q com.apple.quarantine && { echo 'quarantine flag present'; exit 1; }
          git --version
          datalad --version
          git annex version

      - name: Drive the installed app
        run: |
          export DLAD_APP_EXECUTABLE="$HOME/Applications/DataLad Desktop.app/Contents/MacOS/DataLad Desktop"
          node --test e2e/packaged.e2e.mjs

      - name: Install log (on failure)
        if: failure()
        run: cat "$HOME/Library/Logs/DataLad Desktop/install.log"
```

- [ ] **Step 4: Run, expect PASS**

Run: `node --test test/install-script-smoke-workflow.test.js`, then `npm test`.
Also dispatch the workflow once (`gh workflow run install-script-smoke.yml`) after pushing; this is the first real end-to-end proof, and the plan is not done until that run is green.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/install-script-smoke.yml test/install-script-smoke-workflow.test.js
git commit -m "ci: smoke-test install.sh on macos-latest"
```

---

### Task 5: Docs

**Files:**
- Modify: `docs/install.md` (list at the top, the `macOS: "app can't be opened"` section, new section)
- Modify: `CHANGELOG.md` (new top section)
- Test: `test/docs-install-macos.test.js`

- [ ] **Step 1: Write the failing test** — create `test/docs-install-macos.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const doc = await readFile(new URL('../docs/install.md', import.meta.url), 'utf8')

test('install guide leads with the macOS one-liner and also documents download-then-run and uninstall', () => {
  assert.match(doc, /## macOS: install with a script/)
  assert.match(doc, /curl -fsSL https:\/\/github\.com\/MRI-Lab-Graz\/DataLad-desktop\/releases\/download\/v[^\s|]+\/install\.sh \| bash/)
  assert.match(doc, /bash install\.sh/)
  assert.match(doc, /rm -rf "\$HOME\/Applications\/DataLad Desktop\.app"/)
  assert.match(doc, /Apple silicon/)
})
```

- [ ] **Step 2: Run, expect FAIL** — `node --test test/docs-install-macos.test.js`.

- [ ] **Step 3: Edit the docs**

In `docs/install.md`: change the top-list macOS bullet to
`- **macOS (Apple silicon):** \`install.sh\` (see [macOS: install with a script](#macos-install-with-a-script)) or the \`.dmg\` file`.
Insert before `## macOS: "app can't be opened" warning`:

````markdown
## macOS: install with a script

For Apple-silicon Macs, no administrator rights for the app, and no Gatekeeper warning (a file fetched with `curl`
is not quarantined). Open **Terminal** and paste (replace `0.5.1` with the version you want):

```bash
curl -fsSL https://github.com/MRI-Lab-Graz/DataLad-desktop/releases/download/v0.5.1/install.sh | bash
```

Prefer to read it first? Download `install.sh` from the release page, then run `bash install.sh`.

The script checks the app's SHA-256 against the value baked into it, installs the app to `~/Applications`, and
installs git-annex and DataLad with Homebrew when they are missing. If Homebrew itself is missing it asks before
running Homebrew's own installer (which asks for your password). Run the script again any time to update or repair.
The log is `~/Library/Logs/DataLad Desktop/install.log`. Intel Macs: use the `.dmg`.

To uninstall: `rm -rf "$HOME/Applications/DataLad Desktop.app"` (Homebrew's packages stay).
````

In `CHANGELOG.md` add above `## 0.5.0` a `## Unreleased` section in the file's style: macOS `install.sh` (Apple silicon), and the Finder-launch fix (the app now also looks for git-annex and DataLad in `/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin`).

- [ ] **Step 4: Run, expect PASS** — `node --test test/docs-install-macos.test.js`, then `npm test`.

- [ ] **Step 5: Commit**

```bash
git add docs/install.md CHANGELOG.md test/docs-install-macos.test.js
git commit -m "docs: macOS install script in the install guide and changelog"
```

---

## Self-review

- **Spec coverage:** Apple-silicon preflight (T2), Homebrew prompt + tty fallback (T2), hash before extract + versioned URL (T2), `.old` swap + codesign + quarantine strip (T2), log (T2), `--from-dir` (T2, T4), render with template arg (T1), zip + render + upload + SHA256SUMS + attestation + release globs (T3), `macos-latest` smoke job with codesign/datalad/e2e (T4), docs (T5). The resolver fix is already committed (`1ca1c05`).
- **Placeholders:** none; the CHANGELOG entry is described, not templated, because it must match the file's prose style.
- **Consistency:** zip name `DataLad-Desktop-<version>-mac-arm64.zip` in the script, both workflows and the tests; CLI order `<version> <zip> <out> [template]` everywhere.
- **Known limit:** the Homebrew-missing prompt path and a real `brew install` are only exercised by the manual run on a clean Mac (CI runners have Homebrew); the text tests pin the shape. Run it once on a Mac without git-annex before tagging.
