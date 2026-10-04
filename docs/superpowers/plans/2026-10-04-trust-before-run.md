# Trust Before Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A folder or local remote the app did not create itself runs nothing that repository content can influence until the user has confirmed it once (or an administrator pre-trusted its location); the scanner becomes advice and change detection.

**Architecture:** A path becomes an authorized root only through one gate (`createTrustGate`, a pure module with injected scan/ask/authorize), so "authorized implies trusted" holds for every IPC handler that already requires an authorized root. A new trust store (version 2) records `folder` or `tree` trust plus folder identity; an administrator's `trustedRoots` in `policy.json` pre-trusts locations. `main.js` only wires Electron dialogs into the gate.

**Tech Stack:** Node >=20 ESM, `node:test`, Electron 42 (main process wiring pinned by reading `main.js`, as today), git, git-annex, DataLad.

**Spec:** `docs/superpowers/specs/2026-10-04-trust-before-run-design.md` (approved 2026-10-04; the ownership/permission check is deferred, see its "Later" section).

## Global Constraints

- TDD (CLAUDE.md): failing test first, `npm test`. Zero new npm dependencies.
- One commit per task, messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Branch `feat/trust-before-run` (from `main` 25171bb).
- Packaged builds never auto-answer a dialog: the e2e seam needs `!app.isPackaged && process.env.DATALAD_DESKTOP_E2E_CONFIRM === '1'` (wiring test already pins this string).
- Admin policy files stay the same as today (`%ProgramData%\DataLad Desktop\policy.json`, `/Library/Application Support/DataLad Desktop/policy.json`, `/etc/datalad-desktop/policy.json`, plus `resources/policy.json`); an unparseable file contributes no trusted roots.
- Trust file: `userData/trusted-folders.json`, version 2 (`{ "version": 2, "records": { "<canonical path>": { "scope": "folder"|"tree", "findings": [...], "identity": { "ino": "...", "birthtimeNs": "..." } | null } } }`). Version 1 (object path -> findings) is read as `folder` records without identity. A plain array trusts nothing.
- Prompt buttons, in this order: `Cancel` (default and cancel), `Trust this folder`, `Trust everything inside this folder`.
- "Not fully scanned" findings are accepted for the current launch only, never stored.
- Out of scope: sandboxing, ownership/permission check (deferred), revocation UI.

## File Structure

- Modify `src/gui/policy.js` (add `trustedRoots`), `test/policy.test.js`.
- Create `src/gui/trust-store.js` (store v2, `identityOf`), `test/trust-store.test.js`. Remove `createTrustStore` from `src/gui/folder-trust.js` and its three tests from `test/folder-trust.test.js`.
- Modify `src/gui/folder-trust.js` (export `localRemotePaths`, `findRemoteVectors`; `scanLocalRemotes` reuses them), `test/folder-trust.test.js`.
- Create `src/gui/trust-gate.js` (`createTrustGate`, `describeTrustPrompt`, `isEmptyOrMissing`), `test/trust-gate.test.js`.
- Modify `src/gui/main.js` (wire the gate; handlers), `test/trust-wiring.test.js`.
- Modify `SECURITY.md`, `CHANGELOG.md`, `test/security-doc.test.js`.

## Review Focus

1. **Empty folder picked, then foreign content cloned into it.** The picker must not authorize or trust an empty folder (it only remembers it as a *location* so the new-project confirmation is skipped); the clone is never trusted, so its first open asks. Pinned in Task 5.
2. **Path spellings.** A trusted folder reached through a symlink, a trailing separator, a relative path, or a different case (macOS/Windows) is the same folder. Pinned in Task 2 (canonical path).
3. **Folder replaced at the same path** (new USB stick, re-extracted archive): `folder` records with identity ask again; no usable inode skips the check. Pinned in Task 2.
4. **Trust file corrupt, unwritable, or in an old format:** asks again, never throws; old format honoured as specified. Pinned in Task 2.
5. **Admin `trustedRoots`** with symlinks, relative entries, a root equal to the path, a path outside, and an unparseable file. Pinned in Tasks 1 and 2.

---

### Task 1: `trustedRoots` in the admin policy

**Files:** Modify `src/gui/policy.js`, `test/policy.test.js`.

**Interfaces:** Produces `loadPolicy({ env, files }) -> { consoleDisabled: boolean, trustedRoots: string[] }` (absolute strings only, de-duplicated, in file order).

- [ ] **Step 1: Write the failing tests.** In `test/policy.test.js` change the existing default test to expect `{ consoleDisabled: false, trustedRoots: [] }` and append:

```js
test('loadPolicy reads trustedRoots from every policy file and keeps only absolute paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'policy-'))
  const first = join(dir, 'a.json')
  const second = join(dir, 'b.json')
  const share = join(dir, 'share')
  const other = join(dir, 'other')
  await writeFile(first, JSON.stringify({ trustedRoots: [share, 'relative/path', 7, '', null] }))
  await writeFile(second, JSON.stringify({ trustedRoots: [other, share] }))
  assert.deepEqual(loadPolicy({ env: {}, files: [first, second] }).trustedRoots, [share, other])
})

test('loadPolicy ignores a trustedRoots value that is not a list', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'policy-'))
  const file = join(dir, 'policy.json')
  await writeFile(file, JSON.stringify({ trustedRoots: join(dir, 'share') }))
  assert.deepEqual(loadPolicy({ env: {}, files: [file] }).trustedRoots, [])
})

test('loadPolicy: an unreadable policy file contributes no trusted roots and still locks the console', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'policy-'))
  const good = join(dir, 'good.json')
  const bad = join(dir, 'bad.json')
  await writeFile(good, JSON.stringify({ trustedRoots: [join(dir, 'share')] }))
  await writeFile(bad, '{ not json')
  const policy = loadPolicy({ env: {}, files: [bad, good] })
  assert.deepEqual(policy.trustedRoots, [join(dir, 'share')])
  assert.equal(policy.consoleDisabled, true)
  assert.deepEqual(loadPolicy({ env: {}, files: [bad] }).trustedRoots, [])
})
```

- [ ] **Step 2: Run, verify RED.** `node --test test/policy.test.js` — Expected: the new tests and the updated default test FAIL (`trustedRoots` undefined).

- [ ] **Step 3: Implement.** Replace `loadPolicy` in `src/gui/policy.js` (and add `isAbsolute` to the `node:path` import):

```js
export function loadPolicy({ env = process.env, files = [] }) {
  let consoleDisabled = env.DATALAD_DESKTOP_DISABLE_CONSOLE === '1'
  const trustedRoots = new Set()
  for (const file of files) {
    let parsed
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      consoleDisabled ||= error.code !== 'ENOENT' // unreadable is "locked down", never "absent"
      continue // and it names no trusted roots
    }
    consoleDisabled ||= parsed?.consoleDisabled === true
    for (const root of Array.isArray(parsed?.trustedRoots) ? parsed.trustedRoots : []) {
      if (typeof root === 'string' && isAbsolute(root)) {
        trustedRoots.add(root)
      }
    }
  }
  return { consoleDisabled, trustedRoots: [...trustedRoots] }
}
```

- [ ] **Step 4: Run, verify GREEN.** `node --test test/policy.test.js && npm test` — Expected: all PASS.

- [ ] **Step 5: Commit.** `git add src/gui/policy.js test/policy.test.js && git commit -m "feat: administrators can pre-trust locations with trustedRoots in policy.json"` (with the Co-Authored-By line).

---

### Task 2: Trust store version 2

**Files:** Create `src/gui/trust-store.js`, `test/trust-store.test.js`. Modify `src/gui/folder-trust.js` (delete `createTrustStore` and the now-unused `readFileSync`/`writeFileSync` imports; keep `canonical`, still used by `findExecVectors`), `test/folder-trust.test.js` (delete the tests named `trust covers the findings the user saw, and a new finding asks again`, `an old path-only trust file trusts nothing` and `"not fully scanned" is accepted for this session only, never remembered across launches`, and `createTrustStore` from its import; their behaviour moves below).

**Interfaces:**
- Produces `createTrustStore({ file, adminRoots = [] })` returning:
  - `covers(path) -> boolean`: inside an admin root, or inside (or equal to) a `tree` record's path.
  - `decide(path, vectors) -> { trusted: boolean }`: a `folder` record whose accepted findings (plus this launch's "not fully scanned") include every vector and whose identity still matches (or is `null`; a `null` identity is filled in and persisted when the folder has a usable one).
  - `trust(path, { scope: 'folder'|'tree', vectors = [] }) -> void`.
- Produces `identityOf(path) -> { ino: string, birthtimeNs: string } | null` (`null` when the path is missing or the inode is `0`).
- Consumes `NOT_FULLY_SCANNED` from `./folder-trust.js`.

- [ ] **Step 1: Write the failing tests** in `test/trust-store.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { createTrustStore, identityOf } from '../src/gui/trust-store.js'

const scratch = async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'trust-store-')))
  return { base, file: join(base, 'trusted.json') }
}
const folder = async (base, name) => {
  const dir = join(base, name)
  await mkdir(dir, { recursive: true })
  return dir
}

test('nothing is trusted by default', async () => {
  const { base, file } = await scratch()
  const store = createTrustStore({ file })
  const dir = await folder(base, 'ds')
  assert.equal(store.covers(dir), false)
  assert.equal(store.decide(dir, []).trusted, false)
})

test('a folder record trusts that folder for the findings the user saw, and a new finding asks again', async () => {
  const { base, file } = await scratch()
  const dir = await folder(base, 'ds')
  createTrustStore({ file }).trust(dir, { scope: 'folder', vectors: ['config a = 1'] })
  const store = createTrustStore({ file })
  assert.equal(store.decide(dir, ['config a = 1']).trusted, true)
  assert.equal(store.decide(dir, []).trusted, true)
  assert.equal(store.decide(dir, ['config a = 1', 'config b = 2']).trusted, false)
  assert.equal(store.covers(dir), false)
})

test('a folder record does not cover the folders inside it', async () => {
  const { base, file } = await scratch()
  const dir = await folder(base, 'ds')
  const inner = await folder(base, 'ds/inner')
  const store = createTrustStore({ file })
  store.trust(dir, { scope: 'folder' })
  assert.equal(store.covers(inner), false)
  assert.equal(store.decide(inner, []).trusted, false)
})

test('a tree record covers the folder and everything inside it, but not a sibling that shares a name prefix', async () => {
  const { base, file } = await scratch()
  const share = await folder(base, 'share')
  const inner = await folder(base, 'share/lab/ds')
  const lookalike = await folder(base, 'share-other')
  createTrustStore({ file }).trust(share, { scope: 'tree' })
  const store = createTrustStore({ file })
  assert.equal(store.covers(share), true)
  assert.equal(store.covers(inner), true)
  assert.equal(store.covers(lookalike), false)
})

test('admin roots cover what is inside them, not what is outside', async () => {
  const { base, file } = await scratch()
  const root = await folder(base, 'labshare')
  const inner = await folder(base, 'labshare/ds')
  const outside = await folder(base, 'elsewhere')
  const store = createTrustStore({ file, adminRoots: [root] })
  assert.equal(store.covers(root), true)
  assert.equal(store.covers(inner), true)
  assert.equal(store.covers(outside), false)
})

test('a path reached through a symlink or with a trailing separator is the same folder', { skip: process.platform === 'win32' && 'symlinks need privileges' }, async () => {
  const { base, file } = await scratch()
  const dir = await folder(base, 'ds')
  await symlink(dir, join(base, 'alias'))
  createTrustStore({ file }).trust(join(base, 'alias'), { scope: 'folder' })
  const store = createTrustStore({ file })
  assert.equal(store.decide(dir, []).trusted, true)
  assert.equal(store.decide(`${dir}/`, []).trusted, true)
})

test('a folder replaced at the same path asks again; one with no usable identity does not', async () => {
  const { base, file } = await scratch()
  const dir = await folder(base, 'ds')
  const store = createTrustStore({ file })
  store.trust(dir, { scope: 'folder' })
  assert.equal(store.decide(dir, []).trusted, true)
  await rm(dir, { recursive: true })
  await sleep(10)
  await mkdir(dir)
  assert.equal(store.decide(dir, []).trusted, false)
  assert.equal(identityOf(join(base, 'missing')), null)
})

test('a version 1 file (path -> accepted findings) is honoured as folder trust and gains an identity', async () => {
  const { base, file } = await scratch()
  const dir = await folder(base, 'ds')
  await writeFile(file, JSON.stringify({ [dir]: ['config a = 1'] }))
  const store = createTrustStore({ file })
  assert.equal(store.decide(dir, ['config a = 1']).trusted, true)
  assert.equal(store.decide(dir, ['config b = 2']).trusted, false)
  const saved = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(saved.version, 2)
  assert.ok(saved.records[dir].identity)
})

test('an old list-of-paths file, a corrupt file and a missing file trust nothing and never throw', async () => {
  const { base, file } = await scratch()
  const dir = await folder(base, 'ds')
  for (const content of [JSON.stringify([dir]), '{ not json', null]) {
    if (content !== null) await writeFile(file, content)
    const store = createTrustStore({ file })
    assert.equal(store.decide(dir, []).trusted, false)
    assert.equal(store.covers(dir), false)
  }
})

test('"not fully scanned" is accepted for this launch only', async () => {
  const { base, file } = await scratch()
  const dir = await folder(base, 'ds')
  const vectors = ['config a = 1', 'not fully scanned (more than 3 repositories)']
  const store = createTrustStore({ file })
  store.trust(dir, { scope: 'folder', vectors })
  assert.equal(store.decide(dir, vectors).trusted, true)
  assert.equal(createTrustStore({ file }).decide(dir, vectors).trusted, false)
  assert.equal(createTrustStore({ file }).decide(dir, ['config a = 1']).trusted, true)
})

test('an unwritable trust file still trusts for this launch', async () => {
  const { base } = await scratch()
  const dir = await folder(base, 'ds')
  const store = createTrustStore({ file: join(base, 'no-such-folder', 'trusted.json') })
  store.trust(dir, { scope: 'tree' })
  assert.equal(store.covers(dir), true)
})
```

- [ ] **Step 2: Run, verify RED.** `node --test test/trust-store.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/gui/trust-store.js`:

```js
import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { NOT_FULLY_SCANNED } from './folder-trust.js'

// The real path with the file system's own capitalisation (macOS and Windows ignore case), so
// every spelling of a folder is the same key.
const canonical = (path) => {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}
const inside = (child, root) => child === root || child.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
const unscanned = (vector) => vector.startsWith(NOT_FULLY_SCANNED)

// Inode and creation time: if the folder at a path is a different one now (another USB stick, a
// re-extracted archive) the user is asked again. No usable inode (some network shares): no check.
export function identityOf(path) {
  try {
    const stat = statSync(path, { bigint: true })
    return stat.ino === 0n ? null : { ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) }
  } catch {
    return null
  }
}
const sameIdentity = (a, b) => a.ino === b.ino && a.birthtimeNs === b.birthtimeNs

function readRecords(file) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {} // first run, or unreadable: ask again
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {} // version 0, a plain list of paths: trusts nothing
  }
  if (parsed.version === 2 && parsed.records && typeof parsed.records === 'object') {
    return Object.fromEntries(
      Object.entries(parsed.records)
        .filter(([, record]) => record && (record.scope === 'folder' || record.scope === 'tree'))
        .map(([path, record]) => [path, { scope: record.scope, findings: Array.isArray(record.findings) ? record.findings : [], identity: record.identity ?? null }])
    )
  }
  // version 1: { path: [accepted findings] }, exactly the folders the user was asked about
  return Object.fromEntries(
    Object.entries(parsed).filter(([, findings]) => Array.isArray(findings)).map(([path, findings]) => [path, { scope: 'folder', findings, identity: null }])
  )
}

export function createTrustStore({ file, adminRoots = [] }) {
  const roots = adminRoots.map(canonical)
  const records = readRecords(file)
  const thisLaunch = new Map()
  const persist = () => {
    try {
      writeFileSync(file, JSON.stringify({ version: 2, records }))
    } catch {
      // unwritable: trust holds for this launch only
    }
  }
  return {
    covers(path) {
      const key = canonical(path)
      return roots.some((root) => inside(key, root)) || Object.entries(records).some(([trusted, record]) => record.scope === 'tree' && inside(key, trusted))
    },
    decide(path, vectors) {
      const key = canonical(path)
      const record = records[key]
      if (record?.scope !== 'folder') {
        return { trusted: false }
      }
      const launch = thisLaunch.get(key)
      if (!vectors.every((vector) => record.findings.includes(vector) || launch?.has(vector))) {
        return { trusted: false }
      }
      const now = identityOf(key)
      if (record.identity && now && !sameIdentity(record.identity, now)) {
        return { trusted: false }
      }
      if (!record.identity && now) {
        record.identity = now
        persist()
      }
      return { trusted: true }
    },
    trust(path, { scope, vectors = [] }) {
      const key = canonical(path)
      records[key] = { scope, findings: vectors.filter((vector) => !unscanned(vector)), identity: scope === 'folder' ? identityOf(key) : null }
      thisLaunch.set(key, new Set(vectors.filter(unscanned)))
      persist()
    }
  }
}
```

  Then delete `createTrustStore` (and the `readFileSync`/`writeFileSync` imports it alone used) from `src/gui/folder-trust.js`, and the three tests listed above from `test/folder-trust.test.js` (and `createTrustStore` from its import line). `src/gui/main.js` still imports the removed function until Task 5 rewires it, so **the app does not start between Task 2 and Task 5**; no test loads `main.js` (the wiring tests only read its text), so the suite stays green. Everything happens on the feature branch; do not release between those tasks.

- [ ] **Step 4: Run, verify GREEN.** `node --test test/trust-store.test.js test/folder-trust.test.js` — Expected: PASS. (`test/trust-wiring.test.js` still reads `main.js` text and keeps passing until Task 5 rewrites it.)

- [ ] **Step 5: Commit.** `feat: trust store version 2: folder and tree trust, identity, admin roots` (with the Co-Authored-By line). Run `npm test` (green: no test imports `main.js`).

---

### Task 3: Scan a remote path by itself

**Files:** Modify `src/gui/folder-trust.js`, `test/folder-trust.test.js`.

**Interfaces:**
- Produces `localRemotePaths(runner, repo) -> Promise<{ name: string, path: string }[]>`: local-path remotes (including `pushurl` and `insteadOf` rewrites) whose path exists; first remote name wins per path.
- Produces `findRemoteVectors(runner, path, label = '') -> Promise<string[]>`: the findings `scanLocalRemotes` produced for one remote path (every hook, config allowlist), each prefixed with `label`.
- `scanLocalRemotes` keeps its behaviour and now calls both (existing tests pin it).

- [ ] **Step 1: Write the failing tests** (append to `test/folder-trust.test.js`; reuse `withRemote`, `flagged`, `ProcessRunner`):

```js
import { findRemoteVectors, localRemotePaths } from '../src/gui/folder-trust.js'
```
(add to the existing import from `../src/gui/folder-trust.js`)

```js
test('localRemotePaths lists the remotes that are existing local paths', async () => {
  const { clone, remote } = await withRemote()
  const runner = new ProcessRunner()
  assert.deepEqual(await localRemotePaths(runner, clone), [{ name: 'origin', path: remote }])
})

test('localRemotePaths skips network remotes and a remote that is not there', async () => {
  const runner = new ProcessRunner()
  const network = await withRemote({ url: () => 'git@example.invalid:lab/ds.git' })
  assert.deepEqual(await localRemotePaths(runner, network.clone), [])
  const gone = await withRemote({ url: () => join(tmpdir(), 'trust-no-such-share', 'ds') })
  assert.deepEqual(await localRemotePaths(runner, gone.clone), [])
})

test('findRemoteVectors judges one remote path like a repository, with the label in front', async () => {
  const { remote } = await withRemote({ hooks: { 'post-receive': '#!/bin/sh\n:\n' } })
  const out = await findRemoteVectors(new ProcessRunner(), remote, 'R: ')
  assert.equal(out.length, 1)
  assert.match(out[0], /^R: hook post-receive [0-9a-f]{64}$/)
  const clean = await withRemote({ hooks: {} })
  assert.deepEqual(await findRemoteVectors(new ProcessRunner(), clean.remote), [])
})
```

- [ ] **Step 2: Run, verify RED.** `node --test test/folder-trust.test.js` — Expected: FAIL (`localRemotePaths`/`findRemoteVectors` not exported).

- [ ] **Step 3: Implement.** In `src/gui/folder-trust.js` replace `scanLocalRemotes` with:

```js
// The remotes of `repo` that are local paths, as git resolves their URLs (insteadOf, pushurl).
async function listLocalRemotes(runner, repo) {
  const git = (args) => runner.run('git', ['-C', repo, ...args], { timeoutMs: GIT_TIMEOUT_MS })
  const names = await git(['remote'])
  if (names.failed) {
    return { failed: true, remotes: [] }
  }
  const paths = new Map()
  for (const name of names.stdout.split(/\r?\n/).filter(Boolean)) {
    for (const flags of [[], ['--push']]) {
      const urls = await git(['remote', 'get-url', ...flags, '--all', name])
      for (const url of urls.failed ? [] : urls.stdout.split(/\r?\n/).filter(Boolean)) {
        const path = localPath(url, repo)
        if (path && !paths.has(path)) {
          paths.set(path, name)
        }
      }
    }
  }
  return { failed: false, remotes: [...paths].map(([path, name]) => ({ name, path })) }
}

const exists = (path) => lstat(path).then(() => true, () => false)

export async function localRemotePaths(runner, repo) {
  const { remotes } = await listLocalRemotes(runner, repo)
  const present = []
  for (const remote of remotes) {
    if (await exists(remote.path)) {
      present.push(remote)
    }
  }
  return present
}

// Judges one remote path like a repository: its config goes through the allowlist and every hook counts.
export async function findRemoteVectors(runner, path, label = '') {
  const found = []
  // Git may refuse the folder (it belongs to someone else), so the usual layouts are also read directly.
  const asked = await runner.run('git', ['-C', path, 'rev-parse', '--path-format=absolute', '--absolute-git-dir', '--git-common-dir'], { timeoutMs: GIT_TIMEOUT_MS })
  const askedDirs = new Set(asked.failed ? [] : asked.stdout.split(/\r?\n/).filter(Boolean))
  for (const dir of new Set([join(path, '.git'), path, ...askedDirs])) {
    // A folder with a HEAD (or one git itself named) is a git dir: its config and every hook are judged.
    // Otherwise only git-annex's own hook names are looked up (a plain "hooks" folder is just a folder).
    const isGitDir = askedDirs.has(dir) || (await exists(join(dir, 'HEAD')))
    found.push(...(await hooksIn(dir, label, { all: isGitDir })))
    if (!isGitDir) {
      continue
    }
    const configFile = join(dir, 'config')
    if (!(await lstat(configFile).then((info) => info.isFile(), () => false))) {
      continue
    }
    const listed = await runner.run('git', ['config', '--file', configFile, '--list', '--includes', '-z'], { timeoutMs: GIT_TIMEOUT_MS })
    if (listed.failed) {
      found.push(`${NOT_FULLY_SCANNED} (cannot read the config of ${label}${dir})`)
    } else {
      found.push(...judgeConfig(listed.stdout, label))
    }
  }
  return found
}

async function scanLocalRemotes(runner, repo, prefix) {
  const { failed, remotes } = await listLocalRemotes(runner, repo)
  if (failed) {
    return [`${NOT_FULLY_SCANNED} (cannot list the remotes of ${prefix || 'the folder'})`]
  }
  const found = []
  for (const { name, path } of remotes) {
    if (await exists(path)) { // not there (an unplugged drive): nothing can run
      found.push(...(await findRemoteVectors(runner, path, `${prefix}remote ${name} (${path}): `)))
    }
  }
  return found
}
```

- [ ] **Step 4: Run, verify GREEN.** `node --test test/folder-trust.test.js && npm test` — Expected: all PASS (the existing remote tests prove the refactor).

- [ ] **Step 5: Commit.** `refactor: a remote path can be scanned and listed on its own`.

---

### Task 4: The trust gate (pure, no Electron)

**Files:** Create `src/gui/trust-gate.js`, `test/trust-gate.test.js`.

**Interfaces:**
- Consumes `createTrustStore` shape from Task 2 (`covers`, `decide`, `trust`), `describeVectors` from `./folder-trust.js`.
- Produces:
  - `isEmptyOrMissing(path) -> Promise<boolean>` (true for a missing path or a folder with no entries; false for a file or a folder with entries).
  - `describeTrustPrompt({ path, kind, vectors }) -> { title, message, detail, buttons }` (`kind` is `'folder'` or `'remote'`).
  - `createTrustGate({ store, scan, ask, authorize }) -> { require(path, { kind = 'folder', event } = {}), createdByApp(path) }`.
    - `scan(path, kind) -> Promise<string[]>`; `ask({ path, kind, vectors, event }) -> Promise<'cancel'|'folder'|'tree'>`; `authorize(path)` is called only for `kind: 'folder'`.
    - `require` throws `Choose a folder first.` for a non-string/empty path, `Folder not opened: it was not trusted.` (folder) or `Not pushed: the remote folder was not trusted.` (remote) when the answer is not `'folder'`/`'tree'`.

- [ ] **Step 1: Write the failing tests** in `test/trust-gate.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTrustGate, describeTrustPrompt, isEmptyOrMissing } from '../src/gui/trust-gate.js'
import { createTrustStore } from '../src/gui/trust-store.js'

const fakeStore = ({ covers = false, trusted = false } = {}) => {
  const calls = []
  return { calls, covers: () => covers, decide: (path, vectors) => (calls.push(['decide', path, vectors]), { trusted }), trust: (path, record) => calls.push(['trust', path, record]) }
}
const harness = (store, answer = 'folder', vectors = ['config a = 1']) => {
  const log = { scan: [], ask: [], authorize: [] }
  const gate = createTrustGate({
    store,
    scan: async (path, kind) => (log.scan.push([path, kind]), vectors),
    ask: async (info) => (log.ask.push(info), answer),
    authorize: (path) => log.authorize.push(path)
  })
  return { gate, log }
}

test('a path covered by a tree record or an admin root is authorized without scanning or asking', async () => {
  const { gate, log } = harness(fakeStore({ covers: true }))
  await gate.require('/p')
  assert.deepEqual(log, { scan: [], ask: [], authorize: ['/p'] })
})

test('a folder trusted for what the scan found is authorized without asking', async () => {
  const { gate, log } = harness(fakeStore({ trusted: true }))
  await gate.require('/p')
  assert.equal(log.scan.length, 1)
  assert.deepEqual(log.ask, [])
  assert.deepEqual(log.authorize, ['/p'])
})

test('an untrusted folder is scanned, asked about with the findings, recorded, then authorized', async () => {
  const store = fakeStore()
  const { gate, log } = harness(store, 'folder')
  await gate.require('/p', { event: 'E' })
  assert.deepEqual(log.ask, [{ path: '/p', kind: 'folder', vectors: ['config a = 1'], event: 'E' }])
  assert.deepEqual(store.calls.at(-1), ['trust', '/p', { scope: 'folder', vectors: ['config a = 1'] }])
  assert.deepEqual(log.authorize, ['/p'])
})

test('"trust everything inside" is recorded with tree scope', async () => {
  const store = fakeStore()
  const { gate } = harness(store, 'tree')
  await gate.require('/p')
  assert.deepEqual(store.calls.at(-1), ['trust', '/p', { scope: 'tree', vectors: ['config a = 1'] }])
})

test('declining records nothing, authorizes nothing and throws', async () => {
  for (const answer of ['cancel', undefined, 'yes']) {
    const store = fakeStore()
    const { gate, log } = harness(store, answer)
    await assert.rejects(gate.require('/p'), /Folder not opened: it was not trusted\./)
    assert.deepEqual(log.authorize, [])
    assert.ok(!store.calls.some(([kind]) => kind === 'trust'))
  }
})

test('a remote is asked about and recorded, but never authorized as a project root', async () => {
  const store = fakeStore()
  const { gate, log } = harness(store, 'folder', [])
  await gate.require('/share/ds', { kind: 'remote' })
  assert.deepEqual(log.scan, [['/share/ds', 'remote']])
  assert.equal(log.ask[0].kind, 'remote')
  assert.deepEqual(log.authorize, [])
  const declined = harness(fakeStore(), 'cancel', [])
  await assert.rejects(declined.gate.require('/share/ds', { kind: 'remote' }), /Not pushed: the remote folder was not trusted\./)
})

test('anything but a non-empty string is refused', async () => {
  const { gate } = harness(fakeStore())
  for (const bad of [undefined, null, '', '  ', ['/p'], { a: 1 }, 7]) {
    await assert.rejects(gate.require(bad), /Choose a folder first\./)
  }
})

test('a project the app created is recorded as trusted and authorized', () => {
  const store = fakeStore()
  const { gate, log } = harness(store)
  gate.createdByApp('/new')
  assert.deepEqual(store.calls, [['trust', '/new', { scope: 'folder', vectors: [] }]])
  assert.deepEqual(log.authorize, ['/new'])
})

test('with the real store, the second open of a trusted folder does not ask', async () => {
  const base = await mkdtemp(join(tmpdir(), 'gate-'))
  const dir = join(base, 'ds')
  await mkdir(dir)
  const { gate, log } = harness(createTrustStore({ file: join(base, 'trusted.json') }), 'folder', [])
  await gate.require(dir)
  await gate.require(dir)
  assert.equal(log.ask.length, 1)
  assert.equal(log.authorize.length, 2)
})

test('isEmptyOrMissing: missing and empty are true, a folder with entries and a file are false', async () => {
  const base = await mkdtemp(join(tmpdir(), 'gate-'))
  assert.equal(await isEmptyOrMissing(join(base, 'nope')), true)
  assert.equal(await isEmptyOrMissing(base), false)
  const empty = join(base, 'empty')
  await mkdir(empty)
  assert.equal(await isEmptyOrMissing(empty), true)
  await writeFile(join(empty, 'f'), 'x')
  assert.equal(await isEmptyOrMissing(empty), false)
  assert.equal(await isEmptyOrMissing(join(empty, 'f')), false)
})

test('the prompt names the path, lists the findings or says nothing was found, and has the three buttons', () => {
  const found = describeTrustPrompt({ path: '/p', kind: 'folder', vectors: ['config core.sshcommand = evil'] })
  assert.deepEqual(found.buttons, ['Cancel', 'Trust this folder', 'Trust everything inside this folder'])
  assert.match(found.detail, /\/p/)
  assert.match(found.detail, /core\.sshcommand = evil/)
  const clean = describeTrustPrompt({ path: '/p', kind: 'folder', vectors: [] })
  assert.match(clean.detail, /cannot prove a folder is safe/)
  const remote = describeTrustPrompt({ path: '/share/ds', kind: 'remote', vectors: [] })
  assert.match(remote.message, /Pushing to this folder runs programs stored in it/)
})
```

- [ ] **Step 2: Run, verify RED.** `node --test test/trust-gate.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/gui/trust-gate.js`:

```js
import { readdir } from 'node:fs/promises'
import { describeVectors } from './folder-trust.js'

// A missing folder or one with no entries has nothing foreign in it.
export async function isEmptyOrMissing(path) {
  try {
    return (await readdir(path)).length === 0
  } catch (error) {
    return error.code === 'ENOENT'
  }
}

const BUTTONS = ['Cancel', 'Trust this folder', 'Trust everything inside this folder']

export function describeTrustPrompt({ path, kind, vectors }) {
  const found =
    vectors.length > 0
      ? `What the app found there (advice, not a verdict):\n${describeVectors(vectors)}`
      : 'Nothing unusual was found, but this app cannot prove a folder is safe. Only trust folders from people you trust.'
  return kind === 'remote'
    ? { title: 'Push to this folder?', message: 'Pushing to this folder runs programs stored in it.', detail: `${path}\n\n${found}`, buttons: BUTTONS }
    : { title: 'Only open folders you trust', message: 'This folder can run programs on your computer.', detail: `${path}\n\n${found}`, buttons: BUTTONS }
}

// The one place a folder becomes a project root: authorize() is only ever called here, after the folder is
// trusted. The scan is advice for the prompt and the change detector for later opens; it does not decide.
export function createTrustGate({ store, scan, ask, authorize }) {
  return {
    async require(path, { kind = 'folder', event } = {}) {
      if (typeof path !== 'string' || !path.trim()) {
        throw new Error('Choose a folder first.')
      }
      const done = () => {
        if (kind === 'folder') {
          authorize(path)
        }
      }
      if (store.covers(path)) {
        return done()
      }
      const vectors = await scan(path, kind)
      if (store.decide(path, vectors).trusted) {
        return done()
      }
      const answer = await ask({ path, kind, vectors, event })
      if (answer !== 'folder' && answer !== 'tree') {
        throw new Error(kind === 'remote' ? 'Not pushed: the remote folder was not trusted.' : 'Folder not opened: it was not trusted.')
      }
      store.trust(path, { scope: answer, vectors })
      return done()
    },
    createdByApp(path) {
      store.trust(path, { scope: 'folder', vectors: [] })
      authorize(path)
    }
  }
}
```

- [ ] **Step 4: Run, verify GREEN.** `node --test test/trust-gate.test.js && npm test`.

- [ ] **Step 5: Commit.** `feat: one trust gate decides when a folder becomes a project root`.

---

### Task 5: Wire the gate into `main.js` and every handler

**Files:** Modify `src/gui/main.js`, `test/trust-wiring.test.js`. (`e2e/electron-driver.mjs` already sets the seam variable.)

**Interfaces:** Consumes Tasks 1-4. After this task `main.js` has no `requireTrustedFolder`, no `folderTrust()`, and `authorizeRoot` is passed to the gate and called nowhere else.

- [ ] **Step 1: Write the failing wiring tests.** In `test/trust-wiring.test.js` delete the tests named `detectProject checks trust before running git in the folder`, `the folder picker only authorizes a folder the user has trusted`, `create/clone check trust of an existing target before running anything`, `every open re-scans; trust is checked against the current findings`, `the app's own clone/create is not trusted blindly: ...`, `create/clone into a folder outside every opened folder asks in a native dialog first`, `a create/clone target that is not text is refused before anything else`, `a push re-checks the folder and its local remotes at the moment of the push` and `the scanner result is awaited (it is async)`, and append:

```js
test('authorizeRoot is passed to the trust gate and called nowhere else', () => {
  assert.equal((main.match(/authorizeRoot\(/g) ?? []).length, 1, 'only the definition may mention authorizeRoot(')
  assert.match(main, /authorize: authorizeRoot/)
})

test('the old check and the old trust store are gone', () => {
  assert.doesNotMatch(main, /requireTrustedFolder/)
  assert.doesNotMatch(main, /folderTrust\(\)/)
})

test('detectProject goes through the gate before git runs in the folder', () => {
  const body = block("handle('adapter:detectProject'")
  const gate = body.search(/await trustGate\(\)\.require\(projectPath, \{ event \}\)/)
  assert.ok(gate !== -1 && gate < body.indexOf('adapter.detectProject'))
})

test('the folder picker authorizes only through the gate, and an empty folder is only a place for a new project', () => {
  const body = block("handle('dialog:pickDirectory'")
  assert.match(body, /isEmptyOrMissing\(picked\)/)
  assert.match(body, /pickedLocations\.add\(/)
  assert.match(body, /await trustGate\(\)\.require\(picked, \{ event: _event \}\)/)
  assert.ok(body.indexOf('isEmptyOrMissing(picked)') < body.indexOf('trustGate().require(picked'))
})

test('createProject trusts only an empty or missing target; adopting an existing folder asks first', () => {
  const body = block("handle('adapter:runCommand'")
  assert.match(body, /payload\.commandName === 'createProject'[\s\S]*?createdEmpty = await isEmptyOrMissing\(target\)/)
  assert.match(body, /if \(!createdEmpty\) \{\s*await trustGate\(\)\.require\(target, \{ event \}\)/)
  assert.match(body, /result\?\.ok && createdEmpty[\s\S]*?trustGate\(\)\.createdByApp\(/)
})

test('a clone is never trusted or authorized by the app: its first open asks', () => {
  const body = block("handle('adapter:runCommand'")
  assert.equal((body.match(/createdByApp\(/g) ?? []).length, 1)
  assert.doesNotMatch(body, /cloneInstall[\s\S]{0,200}createdByApp/)
})

test('a push re-checks the project and every local-path remote right before the command', () => {
  const body = block("handle('adapter:runCommand'")
  const project = body.search(/commandName === 'push'[\s\S]{0,200}await trustGate\(\)\.require\(payload\.request\.projectPath, \{ event \}\)/)
  const remotes = body.search(/localRemotePaths\(consoleRunner, payload\.request\.projectPath\)[\s\S]{0,200}kind: 'remote'/)
  assert.ok(project !== -1 && remotes !== -1)
  assert.ok(remotes < body.indexOf('adapter.runCommand('))
})

test('a create/clone target outside every opened folder still asks where, unless the user picked it in the native dialog', () => {
  const body = block("handle('adapter:runCommand'")
  assert.match(body, /!isWithinAuthorizedRoot\(target\) && !isWithinRoots\(target, pickedLocations\)/)
  assert.doesNotMatch(body, /isWithinAuthorizedRoot\(dirname\(/)
  const refuse = body.search(/typeof target !== 'string'/)
  assert.ok(refuse !== -1 && refuse < body.indexOf('confirmNewProjectLocation'))
})
```

- [ ] **Step 2: Run, verify RED.** `node --test test/trust-wiring.test.js` — Expected: the new tests FAIL.

- [ ] **Step 3: Implement in `src/gui/main.js`.**
  1. Imports: replace `import { createTrustStore, describeVectors, findExecVectors } from './folder-trust.js'` with
     `import { findExecVectors, findRemoteVectors, localRemotePaths } from './folder-trust.js'`, `import { createTrustStore } from './trust-store.js'` and `import { createTrustGate, describeTrustPrompt, isEmptyOrMissing } from './trust-gate.js'`.
  2. Replace the whole `let trustStore ... async function requireTrustedFolder(...) { ... }` block with:

```js
// Folders the user picked in the native dialog that were empty: only a place for a new project, never a root.
const pickedLocations = new Set()

// E2E has no human: an unpackaged app started by the e2e driver answers "this folder" itself;
// a packaged app never does.
async function askToTrust({ path, kind, vectors, event }) {
  if (!app.isPackaged && process.env.DATALAD_DESKTOP_E2E_CONFIRM === '1') {
    return 'folder'
  }
  const prompt = describeTrustPrompt({ path, kind, vectors })
  const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
    type: 'warning',
    buttons: prompt.buttons,
    defaultId: 0,
    cancelId: 0,
    title: prompt.title,
    message: prompt.message,
    detail: prompt.detail
  })
  return ['cancel', 'folder', 'tree'][response]
}

// The only way a folder becomes a project root: the user said yes, an administrator listed its location,
// or the app created it empty. What the scan finds is advice for the prompt and change detection.
let gate
const trustGate = () =>
  (gate ??= createTrustGate({
    store: createTrustStore({ file: join(app.getPath('userData'), 'trusted-folders.json'), adminRoots: policy.trustedRoots }),
    scan: (path, kind) => (kind === 'remote' ? findRemoteVectors(consoleRunner, path) : findExecVectors(path)),
    ask: askToTrust,
    authorize: authorizeRoot
  }))
```
  3. `adapter:detectProject` becomes:

```js
handle('adapter:detectProject', async (event, projectPath) => {
  await trustGate().require(projectPath, { event })
  return adapter.detectProject(projectPath)
})
```
  4. `dialog:pickDirectory`: replace everything after the `if (result.canceled ...) { return null }` block with:

```js
  const picked = result.filePaths[0]
  // An empty folder has nothing to trust yet: it is only a place to create a project in.
  if (await isEmptyOrMissing(picked)) {
    pickedLocations.add(resolve(picked))
    return picked
  }
  try {
    await trustGate().require(picked, { event: _event })
  } catch {
    return null // the user declined to trust it: it is not authorized
  }
  return picked
```
  5. `adapter:runCommand`: replace the head (everything before `let request = payload.request`) and the final `authorizeRoot(request?.targetPath)` block with:

```js
handle('adapter:runCommand', async (event, payload) => {
  const target = payload.request?.targetPath
  let createdEmpty = false
  if (!COMMANDS_CREATING_A_NEW_PROJECT.has(payload.commandName)) {
    requireAuthorizedRoot(payload.request?.projectPath)
    // A push to a local-path remote (a share, a USB stick) runs that remote's own hooks and uses its config, and
    // the project or the remote may have changed since it was trusted: look again, right before.
    if (payload.commandName === 'push') {
      await trustGate().require(payload.request.projectPath, { event })
      for (const remote of await localRemotePaths(consoleRunner, payload.request.projectPath)) {
        await trustGate().require(remote.path, { kind: 'remote', event })
      }
    }
  } else {
    if (typeof target !== 'string' || !target.trim()) {
      throw new Error('Choose a folder first.')
    }
    if (!isWithinAuthorizedRoot(target) && !isWithinRoots(target, pickedLocations)) {
      await confirmNewProjectLocation(event, target)
    }
    // Only a new, empty project is the app's own. Adopting an existing folder (`create --force`) runs that
    // folder's own settings, and a clone brings content from elsewhere: those are asked about, a clone on its first open.
    if (payload.commandName === 'createProject') {
      createdEmpty = await isEmptyOrMissing(target)
      if (!createdEmpty) {
        await trustGate().require(target, { event })
      }
    }
  }
```
     and at the end of the handler, in place of the old `if (result?.ok && (cloneInstall || createProject)) { authorizeRoot(...) }`:

```js
  if (result?.ok && createdEmpty) {
    trustGate().createdByApp(request.targetPath)
  }
  return result
```
     Update the comment above `COMMANDS_CREATING_A_NEW_PROJECT` to: `// create/clone targets do not exist yet (or are empty); see the trust rules in the handler below.`
  6. Run `node --check src/gui/main.js` and `grep -n "authorizeRoot(" src/gui/main.js` (only the definition).

- [ ] **Step 4: Run, verify GREEN.** `node --test test/trust-wiring.test.js && npm test && env -u ELECTRON_RUN_AS_NODE npm run test:e2e` — Expected: all PASS (e2e opens temp folders through the seam, which answers "this folder").

- [ ] **Step 5: Commit.** `feat: a folder becomes a project root only through the trust gate`.

---

### Task 6: Docs

**Files:** Modify `SECURITY.md`, `CHANGELOG.md`, `test/security-doc.test.js`.

- [ ] **Step 1: Write the failing doc test** (append):

```js
test('SECURITY.md states the trust-before-run rule, its sources, and its limits', () => {
  assert.match(doc, /trust before run|trusts? nothing until/i)
  assert.match(doc, /trustedRoots/)
  assert.match(doc, /Trust everything inside this folder/)
  assert.match(doc, /created[^.]*empty/i)
  assert.match(doc, /share'?s? (own )?permissions/i)
  assert.match(doc, /ownership/i)
  const main = readFileSync(new URL('../src/gui/main.js', import.meta.url), 'utf8')
  assert.match(main, /trustedRoots|policy\.trustedRoots/)
})
```

- [ ] **Step 2: Run, verify RED.** `node --test test/security-doc.test.js`.

- [ ] **Step 3: Write the docs.** In `SECURITY.md` rewrite the **Folder trust** section to: the rule (a folder or remote the app did not create runs nothing repository-controlled until you confirmed it, an administrator listed its location, or the app created it empty; a clone and "create over an existing folder" always ask); the prompt and its three buttons; the scanner's role (advice and change detection, "not fully scanned" per launch); folder identity; `trustedRoots` (where `policy.json` lives, absolute paths only, an unreadable file adds none); remotes asked per path right before a push; the trust file `trusted-folders.json` and how to forget trust (delete the entry or the file). Add to **Known limitations**: another person who can write to a folder or share you trusted can change hooks and settings afterwards; the control is the share's own permissions (only trusted people may write to datasets and their `.git` folders); git author names and emails are self-declared and the files that run code carry no author, so they cannot be used; an ownership and permission check is planned for later (macOS/Linux first). Add a CHANGELOG entry "Trust before run".

- [ ] **Step 4: Run, verify GREEN.** `node --test test/security-doc.test.js && npm test`.

- [ ] **Step 5: Commit.** `docs: trust before run, trustedRoots, share permissions, deferred ownership check`.

---

### Task 7: Release gate

- [ ] `npm test`, `npm run test:e2e` (unset `ELECTRON_RUN_AS_NODE`), `npm audit --omit=dev`: all green.
- [ ] Packaged macOS build (`CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir --mac --arm64`): packaged e2e passes (first run after a fresh unsigned build may time out connecting, rerun). Manual check in the packaged app: opening a folder shows the three-button dialog and Cancel keeps it closed (the seam is dead there).
- [ ] Push `feat/trust-before-run`, open a draft PR, read the Smoke Cross Platform Windows log and macOS (the new store tests include real paths on Windows), installer-smoke (installer unchanged, still run).
- [ ] Fresh independent review focused on the invariant: every IPC handler and every route to `authorizeRoot`, the store's path handling, the picker/empty-folder exception, the push-time check, the e2e seam, policy parsing. Any High finding stops the merge and goes to the user.
- [ ] Update memory (`project_security_findings_pattern.md`, `project_security_hardening_branch.md`).
