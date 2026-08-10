# Windows git-annex CI verification

## Problem

DataLad Desktop was built mainly for Windows researchers, but nothing in this
repo has ever run real `datalad`/`git-annex` in CI on any platform. The e2e
fixtures (`e2e/fixtures.mjs`) deliberately avoid a real DataLad install so
they work identically with or without one — which means the actual question
("does this work for a non-admin Windows user?") has never been answered with
evidence.

The specific risk that prompted this: git-annex represents annexed files as
symlinks, and Windows only allows symlink creation with admin rights or
Developer Mode enabled. Without one of those, git-annex automatically falls
back to an "adjusted unlocked branch" (annexed files become plain regular
files instead of symlinks) — this is git-annex's own built-in,
designed-for-this-exact-case behavior, requiring no elevation and no app-side
handling. `datalad-gooey` (DataLad's own official GUI) relies on this same
fallback and has no Developer Mode handling of its own either — a commented-
out, non-working attempt to force-enable Developer Mode is the only trace of
it in their CI config.

So the app likely already works on a locked-down Windows machine, purely
because git-annex handles the hard part itself. But "likely" isn't good
enough to endorse the app to its main audience. This spec closes that gap
with evidence instead of assumption.

## Non-goals

- No WSL/virtualization-based redesign. Considered and rejected: it trades a
  problem git-annex already solves for a bigger one (WSL2 requires
  virtualization enabled, often locked down on exactly the institutional
  machines most likely to also lock down Developer Mode; adds a distro
  provisioning step, cross-filesystem path translation, and a much larger
  installer).
- No changes to `src/datalad/adapter.js` or the Rust bridge up front. The one
  place that assumes symlink semantics (`fileExists` at `adapter.js:1279`,
  which uses `lstat`) already behaves correctly on plain regular files, so
  there's no known bug to fix yet — only fix what real testing surfaces.
- No new e2e mocking framework. Reuse the existing `node --test` +
  `electron-driver.mjs` harness.

## Design

### 1. CI installs real git-annex + DataLad, no elevation

In `.github/workflows/smoke-cross-platform.yml`, add a step before
`npm test` that installs DataLad and git-annex the same way `datalad-gooey`'s
own CI does — via `datalad-installer`'s `datalad/packages` method, which
requires no admin rights:

```yaml
- name: Install DataLad + git-annex
  run: |
    python -m pip install datalad-installer datalad
    datalad-installer --sudo ok git-annex -m datalad/packages
```

Applied to the full matrix (`windows-latest` + `macos-latest`), not gated to
Windows only — one less conditional, and macOS gets the same free
verification since it's equally unverified today. This runs on the default
GitHub-hosted runner with no admin rights and no Developer Mode toggled,
matching a real, non-technical user's starting conditions.

This step must land after the e2e-hang fix from the prior session (the
`#check-env` selector / dangling-Electron-process fix in
`e2e/electron-driver.mjs`), since without it the Windows/macOS smoke job
never gets past the existing e2e step to reach anything new.

### 2. A real end-to-end annex round trip

Add one new e2e spec, `e2e/real-annex-roundtrip.e2e.mjs`, that — unlike the
existing fixtures — uses a real `datalad create` to make an actual dataset,
drives the app UI to add and Save a file, then shells out to
`git annex whereis <file>` to confirm git-annex actually tracked it as
annexed content.

`git annex whereis` is the right assertion because it's annex-mode-agnostic:
it succeeds identically whether the file is a symlink (macOS/Linux, or
Windows with symlink privilege) or a plain file under an adjusted unlocked
branch (Windows without symlink privilege) — so it's a direct proof that the
adjusted-branch fallback works transparently through the app, which is the
crux of the whole concern.

### 3. Rollout

A Windows VM is available locally, so this doesn't have to be validated
blind through CI round-trips. Install DataLad + git-annex on the VM the same
non-elevated way (no admin rights, no Developer Mode toggle — matching a
real user's machine), run `npm test` and the new e2e spec there directly,
and fix whatever surfaces as a concrete, specific bug rather than a
hypothetical one. Push the CI workflow change once the VM run is clean, so
CI then keeps re-verifying this on every future change instead of it being
a one-time manual check.

## Testing

- Primary validation is manual, on the local Windows VM: install
  DataLad + git-annex non-elevated, run `npm test` and
  `e2e/real-annex-roundtrip.e2e.mjs` there, confirm they pass without
  requiring admin rights or Developer Mode.
- CI (once the workflow step lands) then re-runs the same check on every
  push, so the VM result isn't a one-time fact that can silently rot.
- The new e2e spec must fail loudly (not silently pass) if `git annex
  whereis` reports no location for the saved file, so a broken save path
  can't slip through.

## Open questions

None outstanding — proceed to implementation plan.
