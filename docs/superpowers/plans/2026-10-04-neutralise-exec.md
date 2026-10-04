# Neutralise Dataset-Controlled Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop relying on the folder-trust scanner to list everything git, git-annex and datalad can be told to run. Switch off the overridable vectors where the app starts commands, keep the scanner only for what cannot be switched off, and fail closed on anything unknown.

**Architecture:**
- **Execution layer.** `ProcessRunner.childEnv()` is the one place every git, git-annex and datalad command passes through. It points `core.hooksPath` at an app-owned hooks folder that holds only the stock git-annex hooks, and it neutralises datalad's clone-recklessness setting.
- **Scanner.** `folder-trust.js` keeps checking what cannot be overridden: filter drivers (git-annex needs them), annex and remote settings, and datalad dataset config. It now uses exact allowlists, finds every nested repository, and reports "not fully scanned" instead of silently capping.
- **Renderer escalation.** The paths a compromised window could use (switching the console on, clone/create targets outside authorized roots) need a native confirmation from the main process.

**Tech Stack:** Node ≥20 ESM, `node:test`, Electron 42, git, git-annex, DataLad 1.6.x, NSIS.

**Spec:** the independent security review of merged `main` @ 0c927b3 (2026-10-04, findings F1–F10, summarised below) plus the user's decision: option 2, "neutralise at execution + exact-allowlist scanner".

## Findings this plan implements

| # | Sev | Finding | Task |
|---|---|---|---|
| F1 | High | A nested repo inside a non-git folder is never scanned; the BIDS adopt flow then runs git in it. | 1 (hooks), 4 (tree walk) |
| F2 | High | Gitlinks not listed in `.gitmodules`, and nested repos deeper than 3 or beyond 100, are silently skipped; `git status` still uses their config. | 1, 4 |
| F3 | High | annex/remote settings that make git-annex run programs pass the "family" regex. | 3 |
| F4 | Med | A committed `datalad.clone.reckless` makes cloned subdatasets world-writable. | 2, 3 |
| F5 | Med | A compromised renderer can switch the console on by itself. | 6 |
| F6 | Med | Clone/create targets are not confined, then get authorized and trusted. | 6 |
| F7 | Med | On Windows, datalad's own `git` launches may find a `git.exe` at the dataset root. | 7 (verify first) |
| F8 | Low | `ignoreOsNoiseFiles` writes through a symlinked `.git/info/exclude`. | 8 |
| F9 | Low | Trust is keyed by path, not by what was found. | 5 |
| F10 | Low | `pushurl` value not checked; installer `StartsWith(ProgramW6432)` prefix match; bare `taskkill`. | 8 |

## Global Constraints

- TDD for every change (CLAUDE.md): failing test first; `npm test`.
- Zero new npm dependencies.
- Test fixtures that need a hook, filter or program only create a marker file inside the test's own temp dir (the pattern already used in `test/process-runner.test.js` for `core.fsmonitor`).
- Keep the guard tests green: `process-runner`, `folder-trust`, `trust-wiring`, `ipc-guard`, `windows-installer`, `workflow-security`, `security-doc`.
- One commit per task; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Branch: `fix/neutralise-exec` (from `main` @ 0c927b3).
- Accepted trade-off (user decision): the app no longer runs a user's own git hooks in their projects. Only the stock git-annex hooks run.

## Review Focus

1. **Windows git-annex in adjusted/unlocked mode relies on its `pre-commit` hook.** Saves on Windows must still work with the app-owned hooks folder. Pinned by the Windows e2e (Smoke Cross Platform) plus Task 1's "stock annex hook still runs" test.
2. **Packaged app:** the hooks folder must be a real folder outside the asar. Git cannot run a script inside `app.asar`. Pinned by Task 1's packaging-config test and the packaged e2e in Task 9.
3. **A legitimate dataset with many subdatasets** (more than the scan limit) gets an honest "not fully scanned" prompt once, not a silent pass and not a prompt on every open. Pinned in Tasks 4 and 5.
4. **A user's own repository with a hand-written hook** shows no trust prompt for the hook, because hooks no longer run. Pinned in Task 4 (hooks stop being a vector).
5. **Typed Create Project paths inside an already-authorized root** still work without a dialog. Only targets outside every authorized root get the native confirmation. Pinned in Task 6.

---

### Task 1: Only the stock git-annex hooks ever run

**Files:**
- Create: `build/git-hooks/pre-commit`, `build/git-hooks/post-receive`, `build/git-hooks/post-checkout`, `build/git-hooks/post-merge`, all executable. Copy the bodies verbatim from what `git annex init` writes (generate them in a temp repo and copy; see Step 3).
- Modify: `src/datalad/process-runner.js` (`childEnv`: one more `GIT_CONFIG_KEY_n`)
- Modify: `package.json` (`build.extraResources`: `{ "from": "build/git-hooks", "to": "git-hooks" }`)
- Test: `test/process-runner.test.js`, `test/packaging-config.test.js`

**Interfaces:**
- Produces: `export const HOOKS_DIR` from `process-runner.js`. It is `<process.resourcesPath>/git-hooks` when that folder exists (packaged), else `build/git-hooks` resolved from the module URL (dev and tests). `childEnv` sets `core.hooksPath=HOOKS_DIR` through the same `GIT_CONFIG_COUNT` mechanism as `core.fsmonitor`.

- [ ] **Step 1: Write the failing tests** (append to `test/process-runner.test.js`; `execFileSync`, `existsSync`, `mkdtemp`, `writeFile`, `tmpdir`, `join` are already imported there; add `chmodSync` to the `node:fs` import)

```js
import { HOOKS_DIR } from '../src/datalad/process-runner.js'

test('ProcessRunner points git at the app-owned hooks folder', async () => {
  const result = await new ProcessRunner().run(process.execPath, ['-e',
    'const n=+process.env.GIT_CONFIG_COUNT;const o={};for(let i=0;i<n;i++)o[process.env["GIT_CONFIG_KEY_"+i]]=process.env["GIT_CONFIG_VALUE_"+i];process.stdout.write(o["core.hooksPath"]??"")'])
  assert.equal(result.stdout, HOOKS_DIR)
})

test("a repository's own hook does not run when the app commits", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hooks-'))
  const marker = join(dir, 'hook-ran')
  execFileSync('git', ['init', '-q', dir])
  const hook = join(dir, '.git', 'hooks', 'pre-commit')
  await writeFile(hook, `#!/bin/sh\ntouch '${marker}'\n`)
  chmodSync(hook, 0o755)
  const runner = new ProcessRunner()
  await runner.run('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t.t', 'commit', '-q', '--allow-empty', '-m', 'x'])
  assert.equal(existsSync(marker), false, "the repository's own pre-commit hook ran")
})

test('the app-owned hooks folder holds exactly the stock git-annex hooks', async () => {
  const { readdirSync, readFileSync } = await import('node:fs')
  for (const name of readdirSync(HOOKS_DIR)) {
    assert.match(readFileSync(join(HOOKS_DIR, name), 'utf8'), /^#!\/bin\/sh\n# automatically configured by git-annex\n/)
  }
  assert.ok(readdirSync(HOOKS_DIR).includes('pre-commit'))
})
```

Append to `test/packaging-config.test.js`, following that file's existing pattern of reading `package.json`:

```js
test('the git hooks folder ships outside the asar, where git can run it', () => {
  assert.ok(pkg.build.extraResources.some((r) => r.from === 'build/git-hooks' && r.to === 'git-hooks'))
})
```

If the file names the parsed package something other than `pkg`, use its name.

- [ ] **Step 2: Run, verify RED.** `node --test test/process-runner.test.js test/packaging-config.test.js`. Expected: the import of `HOOKS_DIR` fails, and so does the packaging test.

- [ ] **Step 3: Implement.**
  1. Generate the stock hooks: `T=$(mktemp -d); git init -q $T; git -C $T annex init -q; ls $T/.git/hooks | grep -v sample`. Copy each non-sample hook to `build/git-hooks/` and `chmod 755`. Check each body matches an entry of `ANNEX_HOOKS` in `src/gui/folder-trust.js`; if git-annex writes one the set lacks, add it there too.
  2. In `process-runner.js`:

```js
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Only the stock git-annex hooks ever run: a repository's own hooks (from a zip, a USB stick,
// a nested repo the scanner never saw) are ignored. Packaged: resources/git-hooks (git cannot
// run a script inside app.asar); dev/tests: build/git-hooks.
const packagedHooks = process.resourcesPath ? join(process.resourcesPath, 'git-hooks') : null
export const HOOKS_DIR = packagedHooks && existsSync(packagedHooks)
  ? packagedHooks
  : fileURLToPath(new URL('../../build/git-hooks', import.meta.url))
```

     In `childEnv`, replace the single fsmonitor entry with a loop over both overrides:

```js
  for (const [key, value] of [['core.fsmonitor', 'false'], ['core.hooksPath', HOOKS_DIR]]) {
    const n = Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10) || 0
    env[`GIT_CONFIG_KEY_${n}`] = key
    env[`GIT_CONFIG_VALUE_${n}`] = value
    env.GIT_CONFIG_COUNT = String(n + 1)
  }
```

  3. `package.json` → add the `extraResources` entry.

- [ ] **Step 4: Run, verify GREEN.** `node --test test/process-runner.test.js test/packaging-config.test.js && npm test`. The existing test `ProcessRunner overrides core.fsmonitor ... keeping any inherited GIT_CONFIG_COUNT entries` asserts an exact array. Update it to expect the fsmonitor entry and then the hooksPath entry, and ledger that as a ruling. Then run `npm run test:e2e` (unset `ELECTRON_RUN_AS_NODE`): the save and BIDS-nesting e2e tests prove git-annex still commits with the stock hooks.

- [ ] **Step 5: Commit.** `fix: only the stock git-annex hooks run, whatever hooks a repository ships`

---

### Task 2: datalad ignores a dataset's clone-recklessness setting

**Files:** Modify `src/datalad/process-runner.js` (`childEnv`). Test: `test/process-runner.test.js`.

- [ ] **Step 1: Write the failing tests**

```js
test('ProcessRunner blanks datalad.clone.reckless for every child', async () => {
  const r = await new ProcessRunner().run(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env.DATALAD_CLONE_RECKLESS))'])
  assert.equal(r.stdout, '""')
})

test("a cloned dataset's committed reckless setting does not loosen its subdatasets' permissions", { skip: (!hasDatalad || process.platform === 'win32') && 'needs datalad on POSIX' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reckless-'))
  const src = join(dir, 'src')
  execFileSync('datalad', ['create', src], { stdio: 'ignore' })
  execFileSync('datalad', ['create', '-d', src, join(src, 'sub')], { stdio: 'ignore' })
  execFileSync('git', ['config', '--file', join(src, '.datalad', 'config'), 'datalad.clone.reckless', 'shared-0777'])
  execFileSync('datalad', ['save', '-d', src, '-m', 'x'], { stdio: 'ignore' })
  const dest = join(dir, 'dest')
  const r = await new ProcessRunner().run('datalad', ['install', '-r', '-s', src, '--', dest])
  assert.equal(r.failed, false, r.stderr)
  const shared = execFileSync('git', ['-C', join(dest, 'sub'), 'config', '--get', 'core.sharedrepository']).toString().trim() || ''
  assert.notEqual(shared, '0666')
})
```

The second test needs `git config --get` to tolerate a missing key. Wrap it in `try { … } catch { '' }`, because exit 1 means unset, which is the passing case.

- [ ] **Step 2: Verify RED.** Expected: both tests fail. The second shows `0666`.
- [ ] **Step 3: Implement.** In `childEnv`: `env.DATALAD_CLONE_RECKLESS = '' // a dataset's .datalad/config must not choose how its clones are made`. The reviewer confirmed that an empty value overrides the committed one.
- [ ] **Step 4: Verify GREEN** plus `npm test`.
- [ ] **Step 5: Commit.** `fix: a dataset cannot choose reckless (world-writable) clone modes`

---

### Task 3: Exact allowlists in the scanner

**Files:** Modify `src/gui/folder-trust.js` (`HARMLESS_KEYS`, `ANNEX_KEY`, `ANNEX_RUNS_PROGRAMS`, `isHarmless`, the `scanDataladProcedures` key regex). Test: `test/folder-trust.test.js`.

**Interfaces:** `isHarmless(key, value)` keeps its signature. The annex family check is replaced by two exact sets.

- [ ] **Step 1: Write the failing tests** (append; reuse `repo()` and `flagged()`)

```js
test('annex and remote settings outside the exact allowlist are flagged', async () => {
  for (const snippet of [
    '[remote "o"]\n\tannex-rsync-download-options = x\n',
    '[remote "o"]\n\tannex-rsync-upload-options = x\n',
    '[remote "o"]\n\tannex-rsync-transport = x\n',
    '[annex]\n\tweb-options = x\n',
    '[remote "o"]\n\tannex-gnupg-options = x\n',
    '[annex]\n\tsomething-new = x\n'
  ]) {
    assert.ok((await findExecVectors(await repo({ config: snippet }))).length > 0, `not flagged: ${snippet}`)
  }
})

test('a shared-repository setting is flagged', async () => {
  assert.match(await flagged(await repo({ config: '[core]\n\tsharedrepository = 0666\n' })), /core\.sharedrepository/)
})

test('a pushurl with a program transport is flagged like url', async () => {
  assert.match(await flagged(await repo({ config: '[remote "o"]\n\tpushurl = ext::x\n' })), /remote\.o\.pushurl/)
})

test('.datalad/config clone and get settings are flagged', async () => {
  const dir = await repo()
  await mkdir(join(dir, '.datalad'), { recursive: true })
  await writeFile(join(dir, '.datalad', 'config'), '[datalad "clone"]\n\treckless = shared-0777\n[datalad "get"]\n\tsubdataset-source-candidate-x = y\n')
  const out = await flagged(dir)
  assert.match(out, /datalad\.clone\.reckless/)
  assert.match(out, /datalad\.get\.subdataset-source-candidate-x/)
})
```

The existing tests `the extra settings git and git-annex write on Windows are not flagged` and `annex settings that launch a program are still flagged` must stay green. Together they define the allowlist's lower bound.

- [ ] **Step 2: Verify RED.** Expected: 4 failures.
- [ ] **Step 3: Implement.**
  - Delete `ANNEX_KEY` and `ANNEX_RUNS_PROGRAMS`.
  - Add the two sets below.
  - In `isHarmless`, check `/^annex\./` keys against `ANNEX_HARMLESS`. For `remote.<name>.annex-*` keys, check the suffix after `annex-` against `REMOTE_ANNEX_HARMLESS`.
  - Remove `sharedrepository` from the `core` regex.
  - Apply the `url` value check to `pushurl` too: `/^remote\..+\.(url|pushurl)$/`, and drop `pushurl` from the harmless `remote` regex.
  - In `scanDataladProcedures`, widen the key regex to `/^datalad\.(procedures|locations|clone|get)\./`.

```js
// Exactly the keys git-annex writes itself (macOS/Linux and Windows "crippled filesystem" mode,
// collected from real repositories). Anything else is reported: new option families keep appearing.
const ANNEX_HARMLESS = new Set(['uuid', 'version', 'crippledfilesystem', 'adjustedbranchrefresh', 'backend', 'freezecontent', 'sshcaching', 'thin'])
const REMOTE_ANNEX_HARMLESS = new Set(['uuid', 'ignore', 'cost', 'sync', 'readonly', 'config-uuid'])
```

  Before finalising the sets, create a real dataset, clone it with datalad, and add a subdataset, as in the 2026-10-04 check. That check found only `annex.uuid`, `annex.version` and `remote.origin.annex-uuid`; the Windows keys come from the existing fixture. Add a key only with that kind of evidence, and ledger each addition.

- [ ] **Step 4: Verify GREEN** plus `npm test`, including `a freshly created DataLad dataset is not flagged`.
- [ ] **Step 5: Commit.** `fix: folder trust uses exact allowlists for annex, remote and datalad settings`

---

### Task 4: Find every nested repository, and fail closed at the limits

Hooks no longer run (Task 1), so they stop being a vector, and the scanner stops reporting them. This removes the hook-body allowlist (`ANNEX_HOOKS`) and its tests, unless Task 1 still needs the set to check the shipped hooks.

**Files:** Modify `src/gui/folder-trust.js` (`scan`, `findExecVectors`). Test: `test/folder-trust.test.js`.

**Interfaces:**
- `findExecVectors(path)` returns vectors for:
  - the repository containing `path` (if any);
  - every `.git` entry (folder or file) found by walking the folder tree under `path`, skipping symlinks and not descending into `.git` folders;
  - every gitlink in any scanned repo's index (`git ls-files --stage`, mode `160000`) that has a checked-out work tree.
- Limits: at most `MAX_REPOS = 200` repositories and `MAX_ENTRIES = 200000` directory entries walked. Reaching either adds the vector `not fully scanned (<reason>)`.

- [ ] **Step 1: Write the failing tests**

```js
test('a repository nested inside a folder that is not a repository is scanned', async () => {
  const top = await realpath(await mkdtemp(join(tmpdir(), 'trust-')))
  const sub = join(top, 'sub-01')
  await mkdir(sub)
  git(sub, 'init', '-q')
  appendFileSync(join(sub, '.git', 'config'), '[filter "x"]\n\tclean = y\n')
  assert.match(await flagged(top), /sub-01: config filter\.x\.clean/)
})

test('a gitlink missing from .gitmodules is scanned', async () => {
  const top = await repo()
  const hidden = join(top, 'hidden')
  await mkdir(hidden)
  git(hidden, 'init', '-q')
  git(hidden, '-c', 'user.name=t', '-c', 'user.email=t@t.t', 'commit', '-q', '--allow-empty', '-m', 'x')
  appendFileSync(join(hidden, '.git', 'config'), '[filter "x"]\n\tclean = y\n')
  git(top, 'add', 'hidden')
  assert.match(await flagged(top), /hidden: config filter\.x\.clean/)
})

test('a repository nested deeper than the old depth limit is scanned', async () => {
  const top = await repo()
  const deep = join(top, 'a', 'b', 'c', 'd', 'e')
  await mkdir(deep, { recursive: true })
  git(deep, 'init', '-q')
  appendFileSync(join(deep, '.git', 'config'), '[filter "x"]\n\tclean = y\n')
  assert.match(await flagged(top), /filter\.x\.clean/)
})

test('hitting the scan limit is reported, never a silent pass', async () => {
  const top = await realpath(await mkdtemp(join(tmpdir(), 'trust-')))
  for (let i = 0; i < 3; i++) { const d = join(top, `r${i}`); await mkdir(d); git(d, 'init', '-q') }
  assert.match((await findExecVectors(top, { maxRepos: 2 })).join('\n'), /not fully scanned/)
})

test("a repository's own hook is no longer reported: hooks never run", async () => {
  const dir = await repo({ hooks: { 'pre-commit': '#!/bin/sh\necho hi\n' } })
  assert.deepEqual(await findExecVectors(dir), [])
})
```

- [ ] **Step 2: Verify RED.** Expected: 5 failures. The last one fails because hooks are still reported today.
- [ ] **Step 3: Implement.**
  1. `findExecVectors(path, { runner, maxRepos = 200, maxEntries = 200000 })`.
  2. Collect the repo roots to scan:
     - `git -C path rev-parse --show-toplevel`, if that succeeds;
     - an iterative walk (`readdir` with `withFileTypes`) under `path` that records the parent of every `.git` entry, skips symlinks, never enters `.git`, and counts entries against `maxEntries`;
     - for each repo, `git -C repo ls-files --stage -z`: for entries with mode `160000`, add `join(repo, path)` if it contains a `.git`.
  3. De-duplicate with `realpath`.
  4. For each root, run the existing config, `.datalad/config` and procedures checks (the `scan` body minus the hooks and `.gitmodules` recursion), prefixing findings with the path relative to `path`.
  5. Push `not fully scanned (…)` when a limit stops the walk.
  6. Delete the hooks loop and `MAX_SUBDATASETS` / `MAX_DEPTH`.
  7. Update the tests that expected hook findings: `the stock git-annex hooks and filter are not flagged` stays green, while `a git-annex hook with an extra line is flagged` and `an odd entry inside hooks/ ...` now expect `[]`. Ledger that as a ruling: "hooks are neutralised by Task 1".
- [ ] **Step 4: Verify GREEN** plus `npm test`. Also time a scan of a real dataset with about 1000 files: it must stay well under 1 s (record the number in the ledger).
- [ ] **Step 5: Commit.** `fix: folder trust scans every nested repository and reports when it could not finish`

---

### Task 5: Trust remembers what was accepted, not just the path

**Files:** Modify `src/gui/folder-trust.js` (`createTrustStore`) and `src/gui/main.js` (`requireTrustedFolder`; the clone/create auto-trust). Test: `test/folder-trust.test.js`, `test/trust-wiring.test.js`.

**Interfaces:**
- `createTrustStore(file)` returns `{ accepts(path, vectors), add(path, vectors) }`.
- `accepts` is true when every current vector was in the stored list for that canonical path.
- The stored file format becomes `{ "<path>": ["vector", ...] }`. An old array-format file is read as "nothing accepted" (fail closed).

- [ ] **Step 1: Write the failing tests**

```js
test('trust covers the findings the user saw, and a new finding asks again', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'store-')), 'trusted.json')
  const store = createTrustStore(file)
  store.add('/p', ['config a'])
  assert.equal(createTrustStore(file).accepts('/p', ['config a']), true)
  assert.equal(createTrustStore(file).accepts('/p', ['config a', 'config b']), false)
  assert.equal(createTrustStore(file).accepts('/p', []), true)
})

test('an old path-only trust file trusts nothing', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'store-')), 'trusted.json')
  writeFileSync(file, JSON.stringify(['/p']))
  assert.equal(createTrustStore(file).accepts('/p', ['config a']), false)
})
```

(Import `writeFileSync` from `node:fs` in that test file.) Replace the existing `the trust store remembers folders across instances` test with the first one above. In `test/trust-wiring.test.js`, add:

```js
test('every open re-scans; trust is checked against the current findings', () => {
  assert.match(main, /findExecVectors\(projectPath\)[\s\S]*?folderTrust\(\)\.accepts\(projectPath, vectors\)/)
  assert.doesNotMatch(main, /folderTrust\(\)\.has\(/)
})

test("the app's own clone/create is trusted with what was found in it, not blindly", () => {
  assert.match(main, /folderTrust\(\)\.add\(request\.targetPath, await findExecVectors\(request\.targetPath\)\)/)
})
```

- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement.**
  - In `requireTrustedFolder`: `const vectors = await findExecVectors(projectPath); if (vectors.length === 0 || folderTrust().accepts(projectPath, vectors)) return; …dialog…; folderTrust().add(projectPath, vectors)`.
  - After a successful clone/create: `folderTrust().add(request.targetPath, await findExecVectors(request.targetPath))`. The app's own clones are still trusted, but only for what was there when the app made them.
- [ ] **Step 4: Verify GREEN** plus `npm test`.
- [ ] **Step 5: Commit.** `fix: trust is remembered per finding, and every open re-scans`

---

### Task 6: A compromised renderer cannot switch the console on or create/clone outside opened folders

**Files:** Modify `src/gui/main.js` (`console:setEnabled`, `adapter:runCommand`). Test: `test/trust-wiring.test.js` (main.js is pinned by reading it), plus e2e `e2e/console-gate.e2e.mjs`.

- [ ] **Step 1: Write the failing tests** (in `test/trust-wiring.test.js`)

```js
test('turning the console on asks in a native dialog from the main process', () => {
  const handler = main.slice(main.indexOf("handle('console:setEnabled'"), main.indexOf("handle('console:runCommand'"))
  assert.match(handler, /dialog\.showMessageBox/)
})

test('create/clone into a folder outside every opened folder asks in a native dialog', () => {
  const handler = main.slice(main.indexOf("handle('adapter:runCommand'"), main.indexOf("handle('prism:inspect'"))
  assert.match(handler, /isWithinAuthorizedRoot\(dirname\(/)
  assert.match(handler, /confirmNewProjectLocation/)
})
```

  The e2e `console-gate.e2e.mjs` currently enables the console through the UI. Check how the driver clicks the toggle. If a native dialog would block it, have the e2e stub `dialog.showMessageBox` the way other e2e tests handle native dialogs (look in `e2e/electron-driver.mjs` for an existing hook). If there is none, add an env-gated test hook only in non-packaged builds, and ledger it.

- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement.**
  - **`console:setEnabled`:** when `enabled` is true and the console is currently off, show a warning `dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), { type: 'warning', buttons: ['Cancel', 'Turn on the console'], defaultId: 0, cancelId: 0, message: 'The console runs any command you type, with your permissions.' })`, and only set `consoleEnabled` on response `1`.
  - **`adapter:runCommand`:** for `cloneInstall`/`createProject`, when `!isWithinAuthorizedRoot(dirname(resolve(target)))`, call a new `confirmNewProjectLocation(event, target)`. It shows a native dialog naming the full path and throws `Error('Not created: location not confirmed.')` on cancel. A folder picked in the native dialog is already authorized, so normal use still sees no dialog.
- [ ] **Step 4: Verify GREEN:** `npm test` and `npm run test:e2e`.
- [ ] **Step 5: Commit.** `fix: the console and new-project locations outside opened folders need a native confirmation`

---

### Task 7: Windows: can datalad's own git launch find a git.exe in the dataset? (verify, then fix)

The finding is PLAUSIBLE, not confirmed. Prove it before changing anything (systematic-debugging, Phase 1).

**Files:** Test: `test/windows-planted-exe.test.js` (new, `skip` unless `win32`).

- [ ] **Step 1: Write the probe test.**
  1. Create a temp dataset with datalad.
  2. Copy `C:\Windows\System32\hostname.exe` to `<dataset>\git.exe` (harmless, and its output is recognisable).
  3. Run `datalad -C <dataset> status` through `ProcessRunner`.
  4. Assert the result did not fail and that its output does not contain the machine's hostname (`os.hostname()`).

  If the planted copy ran, datalad would get the hostname back instead of git output, and the status would fail or come out wrong.
- [ ] **Step 2: Push the branch and read the Windows job log** of Smoke Cross Platform (open a draft PR so it runs).
   - **Passes:** the finding is not reproducible. Keep the test as a regression guard and ledger the result. Done.
   - **Fails:** the finding is confirmed. Fix: run datalad from a neutral cwd (`os.tmpdir()`), keep `-C <projectPath>`, and pass `NoDefaultCurrentDirectoryInExePath` (already set). If datalad still `chdir`s before launching git, use `-d <projectPath>` with absolute paths instead of `-C` in the adapter builders. Re-run until green, and ledger the root cause.
- [ ] **Step 3: Commit** the test (and the fix, if needed): `test: a git.exe inside a dataset is never what datalad runs on Windows`.

---

### Task 8: Low-severity fixes

**Files:** `src/datalad/adapter.js` (`#addOsNoiseExcludes`), `src/datalad/kill-tree.js`, `build/installer.nsh`. Tests: `test/adapter.test.js` (or the file that covers OS-noise excludes; `grep -l ignoreOsNoiseFiles test/`), `test/windows-installer.test.js`, `test/process-runner.test.js`.

- [ ] **Step 1: Write the failing tests**

```js
// adapter: symlinked info/exclude is refused, nothing is written through it
test('ignoreOsNoiseFiles never writes through a symlinked info/exclude', { skip: process.platform === 'win32' && 'symlinks need privileges' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'excl-'))
  execFileSync('git', ['init', '-q', dir])
  const outside = join(await mkdtemp(join(tmpdir(), 'outside-')), 'target.txt')
  await writeFile(outside, 'original\n')
  await rm(join(dir, '.git', 'info', 'exclude'), { force: true })
  await symlink(outside, join(dir, '.git', 'info', 'exclude'))
  await new DataLadAdapter().ignoreOsNoiseFiles(dir)
  assert.equal(await readFile(outside, 'utf8'), 'original\n')
})

// installer: Program Files check cannot be fooled by a "Program Files2" prefix
test('the machine PATH entry needs the install folder inside Program Files, not just a matching prefix', () => {
  assert.match(nsh, /StartsWith\(\$\$env:ProgramW6432 \+ '\\'/)
})

// kill-tree: taskkill by absolute path
test('taskkill is started by absolute path', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/datalad/kill-tree.js', import.meta.url), 'utf8')
  assert.match(src, /SystemRoot[^\n]*System32[^\n]*taskkill\.exe/)
})
```

  Add the imports each test file lacks (`symlink`, `rm`, `readFile`, `DataLadAdapter`).
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement.**
  - **adapter:** before reading or writing `excludePath`, `lstat` it. If it exists and is not a regular file, return `{ datasetPath, added: false }`. Also refuse when `realpath(excludeDir)` is outside `realpath(datasetPath)` and outside the main repo's git dir (`git rev-parse --git-common-dir`).
  - **kill-tree:** `spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), …)`.
  - **installer:** `$$scripts.StartsWith($$env:ProgramW6432 + '\', [StringComparison]::OrdinalIgnoreCase)`.
- [ ] **Step 4: Verify GREEN** plus `npm test`.
- [ ] **Step 5: Commit.** `fix: small hardening (symlinked exclude file, Program Files prefix, absolute taskkill)`

---

### Task 9: Docs, release gate, fresh review

- [ ] **SECURITY.md:**
  - Controls: the app-owned hooks folder (and that users' own hooks no longer run), `DATALAD_CLONE_RECKLESS`, exact allowlists, nested-repo discovery, the "not fully scanned" finding, trust per finding, native confirmations.
  - Correct the console wording: the main-process gate plus a native confirmation; the admin `policy.json` is the hard control.
  - Known limitations: drop the items now fixed. Add "the app does not run your own git hooks in projects it manages".

  First extend `test/security-doc.test.js` with `assert.match(doc, /core\.hooksPath/)` and `assert.match(doc, /DATALAD_CLONE_RECKLESS/)` (RED), then write the docs (GREEN). Update CHANGELOG.
- [ ] `npm test`, `npm run test:e2e` (with `ELECTRON_RUN_AS_NODE` unset), and `npm audit --omit=dev`: all green.
- [ ] Packaged macOS app (`CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir --mac --arm64`): the packaged e2e passes, and `resources/git-hooks` exists inside the `.app` with executable hooks.
- [ ] `installer-smoke` on Windows green (step log read), and Smoke Cross Platform green on the PR (Windows job log read; Task 7's probe result recorded).
- [ ] **Fresh independent security review** of the branch before merge, with the same brief as the 2026-10-04 review plus "verify F1–F10 are closed and look for new bypasses of the hooks/allowlist design". Any High finding sends us back to a new plan, not to merge.
- [ ] Update memory `project_security_hardening_branch.md`.
