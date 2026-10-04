# Trust before run: design

Date: 2026-10-04. Status: approved by the owner (2026-10-04), with the ownership check below deferred.

## Why

Four independent security reviews found 12 High issues in how DataLad Desktop keeps repository-controlled
code from running (see `SECURITY.md`, `project_security_findings_pattern` in the project memory). Eleven were
the same failure: the app's scanner is an enumeration of places and settings through which git, git-annex and
datalad can run code, and that surface is open-ended, so each review found another member. The fix is to
change the rule, not to extend the list.

**New rule:** a folder or remote the app did not create itself runs nothing that repository content can
influence until the user has confirmed that folder once. The scanner stops being the gate. It shows what it
found as advice in the prompt and detects later changes.

## Goal and success criteria

- Nothing repository-controlled (git, git-annex, datalad, anything they start) runs in a folder or against a
  local-path remote unless the user confirmed it, an administrator pre-trusted a location containing it, or the
  app created it empty.
- A gap in the scanner no longer lets code run in a folder the user was asked about.
- Researchers who work on lab shares are not drowned in prompts: one prompt per dataset, or one per share root.

Non-goals (YAGNI): sandboxing the tools (the only protection against another person writing to a share the user
already trusted; documented as a limit), a UI for revoking trust (the trust file location is documented), an
environment-variable form of the admin setting, per-command policies.

## The invariant

A path becomes an **authorized root** (`authorizeRoot` in `src/gui/main.js`) only after it is trusted. Every
IPC handler that touches a folder already requires an authorized root (`requireAuthorizedRoot`, the file
handlers, the console), so "authorized implies trusted" enforces the rule in one place. Consequences:
- `authorizeRoot` is called only on the success path of the trust check.
- The existing `authorizeRoot(request.targetPath)` after a successful clone/create is removed for clones: a
  clone is foreign content and is asked about on its first open. A project the app created in a missing or empty
  folder is trusted (nothing foreign in it).
- The development-only authorization of the launch directory stays (documented; never in packaged builds).

## What counts as trusted

1. **Created by the app:** `createProject` into a folder that does not exist or has no entries. Recorded as trusted
   with no findings.
2. **Confirmed by the user** in the prompt, as a `folder` record (this folder) or a `tree` record (this folder and
   everything inside it).
3. **Pre-trusted by an administrator:** `trustedRoots` (array of absolute paths) in the system `policy.json`
   (`%ProgramData%\DataLad Desktop\`, `/Library/Application Support/DataLad Desktop/`, `/etc/datalad-desktop/`) or
   the `policy.json` in the app's resources folder. A path inside any root is trusted without a prompt. A policy
   file that cannot be parsed contributes no trusted roots (fail closed; `consoleDisabled` stays locked down as
   today). Relative or non-string entries are ignored.
4. Everything else is untrusted: a fresh clone, Create Project over an existing folder (adopt), a folder picked
   or typed by the user, a local-path remote.

## Trust store

`trusted-folders.json` in `userData`, version 2:

```json
{ "version": 2, "records": { "<canonical path>": { "scope": "folder" | "tree", "findings": ["..."], "identity": { "ino": "123", "birthtimeMs": 1.7e12 } | null } } }
```

- `folder` trust holds the findings the user saw. A later open that finds something not in that list asks again
  (today's per-finding behaviour; "not fully scanned" is accepted for the current launch only, never stored).
- `tree` trust accepts everything inside the folder and does not re-ask on findings.
- **Identity** (`folder` records only): inode and creation time of the folder when trust was given. If the folder
  at that path is now a different one (a different USB stick, a re-extracted archive) the user is asked again. If
  the filesystem reports no usable inode (`0`/missing), identity is `null` and the check is skipped.
- A version-1 file (an object mapping paths to accepted findings; those are exactly the folders the user was
  asked about) is read as `folder` records with `identity: null`, which is filled in on the next successful
  check. A version-0 file (a plain array) trusts nothing. An unreadable or unwritable file means ask again; if it
  cannot be written, trust holds for the current launch only.

Lookup order for a path: admin root, then a `tree` record on the path or any ancestor, then a `folder` record for
the path itself (findings subset and identity match), otherwise ask.

## The check and the prompt

`requireTrust(event, path, { kind })` in `src/gui/main.js` (replacing `requireTrustedFolder`), `kind` is
`'folder'` or `'remote'`:

1. Not a string or empty: throw (also validated in `schema.js`, already done).
2. Trusted by the rules above: authorize and return.
3. Otherwise scan (read-only: `git config --file`, `rev-parse`, `ls-files`, directory reads; none run
   repository code) and show a native dialog:
   - **Cancel** (default), **Trust this folder**, **Trust everything inside this folder**.
   - Text: the path, the findings from `describeVectors` as advice, and for a clean scan the sentence "Nothing
     unusual was found, but this app cannot prove a folder is safe. Only trust folders from people you trust."
     For a remote: "Pushing to this folder runs programs stored in it."
   - Cancel throws `Folder not opened: it was not trusted.`
4. Record the answer (scope, findings, identity), authorize the path, return.

## Where it is enforced

- `adapter:detectProject` and `dialog:pickDirectory`: `requireTrust(path, 'folder')` then `authorizeRoot`.
- `adapter:runCommand` `createProject`: a missing or empty target is trusted and authorized after success; an
  existing non-empty target (adopt) goes through `requireTrust` before the command.
- `adapter:runCommand` `cloneInstall`: the target is never trusted automatically, because the content comes from
  elsewhere. It is not authorized after the clone; its first open asks.
- `adapter:runCommand` `push`: `requireTrust` for the project and for every local-path remote of it
  (`kind: 'remote'`), right before the command.
- All other handlers keep `requireAuthorizedRoot`, which now implies trust.
- The location confirmation for new projects outside opened folders stays.

## Scanner changes

- `findRemoteVectors(runner, remotePath, label)` is extracted from `scanLocalRemotes` so a remote path can be
  scanned and prompted on by itself; `localRemotePaths(runner, repo)` is exported for the push check.
- `scanLocalRemotes` keeps running when a project is opened, so findings in remotes appear in the project's
  advice; trust for the remote itself is asked at push time.
- No scanner behaviour is removed: it is the advice and the change detector.

## Errors and edge cases

- A scanner failure or "not fully scanned" appears in the prompt text; it never blocks the user's decision and is
  never remembered across launches.
- Symlinked or relative paths are canonicalised (`realpath`) before lookup and before storing.
- A trusted path that disappears and returns as a different folder is caught by identity (`folder` records) or
  trusted by the user's choice (`tree` records).
- Another user writing to a share the user trusted is not covered. Documented in `SECURITY.md`; needs a sandbox.
- Existing users: folders the old store recorded stay trusted (version-1 read); every other folder asks once.

## Testing

- Wiring tests (reading `main.js`, as today): `authorizeRoot` appears only on trusted paths; every handler that
  previously called `requireTrustedFolder` calls `requireTrust`; push checks the remotes; no `authorizeRoot`
  after a clone; no call to the removed function.
- Unit tests for the trust store (scopes, ancestor lookup, identity match and mismatch, `null` identity, version
  0/1/2 files, unwritable file, "not fully scanned" per launch) and for the admin roots (valid, relative, invalid
  policy, root containing the path, path outside).
- Real-flow tests with real git/datalad where available: new empty folder trusted, adopt asks, clone asks, push to
  a local remote asks per remote path, tree trust covers a subfolder, a replaced folder asks again.
- The e2e seam `DATALAD_DESKTOP_E2E_CONFIRM=1` (only when `!app.isPackaged`) answers the trust dialog with "Trust
  this folder"; wiring test keeps it dead in packaged builds.
- `SECURITY.md` and its doc test are updated: the rule, the prompt, `trustedRoots`, the scanner's new role, the
  limits.

## Shared folders: what protects them in this version

Another person who can write into a share you trusted can change hooks and settings there after the fact. The
app cannot tell a legitimate change from a malicious one, and git identities do not help: author names and
emails are self-declared, and the files that run code (`.git/hooks`, `.git/config`, git-annex hooks, a remote's
own hooks) are loose files with no author and no signature. The control for this version is therefore the share's
own permissions: only people you trust may write to the datasets and their `.git` folders. This goes into
`SECURITY.md` and the deployment notes. Keeping working copies local and using a share only as a push target helps
too: the per-remote prompt covers that case.

## Later (not in this version)

**Ownership and permission check** (decided 2026-10-04 to defer): treat a trusted folder as trusted only while it
is owned by the current user or an administrator-listed account and is not writable by group or others. This
would narrow the shared-folder gap above. macOS and Linux first (a file stat is enough); Windows needs a safe way
to read access-control lists and is a separate decision. It would be an extra condition on `trustedRoots` and on
`folder`/`tree` records, so the trust store format (`version: 2`) should leave room for it.

## Open risks

- Prompt fatigue (mitigated by "everything inside" and `trustedRoots`).
- Inode instability on some network shares could cause an occasional repeat prompt for `folder` records.
- Trust is by path: a `tree` trust on a share root means a folder added there later by someone else is trusted.
  That is the user's explicit choice and is stated in the prompt button.
