import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, chmod, realpath, symlink, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findExecVectors, createTrustStore, describeVectors } from '../src/gui/folder-trust.js'

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' })
const ANNEX_FILTER = `[filter "annex"]
\tsmudge = git-annex smudge -- %f
\tclean = git-annex smudge --clean -- %f
\tprocess = git-annex filter-process
`
const ANNEX_PRE_COMMIT = '#!/bin/sh\n# automatically configured by git-annex\ngit annex pre-commit .\n'

async function hook(gitDir, name, body) {
  await mkdir(join(gitDir, 'hooks'), { recursive: true })
  const file = join(gitDir, 'hooks', name)
  await writeFile(file, body)
  await chmod(file, 0o755)
}

// A real repository, so the scanner is tested against what git itself reads.
async function repo({ config = '', hooks = {} } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'trust-')))
  git(dir, 'init', '-q')
  appendFileSync(join(dir, '.git', 'config'), config)
  for (const [name, body] of Object.entries(hooks)) await hook(join(dir, '.git'), name, body)
  return dir
}
const flagged = async (dir) => (await findExecVectors(dir)).join('\n')

test('a plain repo with sample hooks has nothing that can run code', async () => {
  assert.deepEqual(await findExecVectors(await repo({ hooks: { 'pre-commit.sample': '#!/bin/sh\nexit 0\n' } })), [])
})

test('the stock git-annex hooks and filter are not flagged', async () => {
  const dir = await repo({ config: ANNEX_FILTER + '[annex]\n\tuuid = 1234\n\tversion = 10\n', hooks: { 'pre-commit': ANNEX_PRE_COMMIT } })
  assert.deepEqual(await findExecVectors(dir), [])
})

// `git annex init` on Windows (no symlinks, "crippled" filesystem) writes more keys than on macOS/Linux;
// flagging them made a perfectly normal DataLad dataset prompt on every open.
test('the extra settings git and git-annex write on Windows are not flagged', async () => {
  const dir = await repo({
    config: '[core]\n\tsymlinks = false\n\tlongpaths = true\n\tprotectntfs = true\n\thidedotfiles = dotgitonly\n' +
      '[annex]\n\tcrippledfilesystem = true\n\tadjustedbranchrefresh = true\n\tbackend = SHA256E\n\tfreezecontent = false\n\tsshcaching = true\n' +
      '[remote "origin"]\n\turl = https://example.org/ds.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n\tannex-uuid = 1\n\tannex-ignore = true\n\tannex-cost = 150\n'
  })
  assert.deepEqual(await findExecVectors(dir), [])
})

test('annex settings that launch a program are still flagged', async () => {
  for (const snippet of [
    '[annex]\n\tssh-options = -o ProxyCommand=evil\n',
    '[annex]\n\tsecure-erase-command = evil\n',
    '[annex]\n\tstalldetection = 1\n\thttp-headers-command = evil\n',
    '[remote "o"]\n\tannex-externaltype = evil\n',
    '[remote "o"]\n\tannex-shell = evil\n',
    '[remote "o"]\n\tannex-rsync-options = -e evil\n',
    '[remote "o"]\n\tannex-ssh-options = -o ProxyCommand=evil\n',
    '[core]\n\teditor = evil\n'
  ]) {
    assert.ok((await findExecVectors(await repo({ config: snippet }))).length > 0, `not flagged: ${snippet}`)
  }
})

test('config that can run programs is flagged, however it is spelled', async () => {
  for (const snippet of [
    '[core]\n\tsshCommand = evil\n',
    '[core]\n\tfsmonitor = touch x\n',
    '[core]\n\thooksPath = /tmp/hooks\n',
    '[core] hooksPath = /tmp/evil\n', // key on the header line
    '[CORE]\n\tHOOKSPATH = /tmp/evil\n',
    '[alias]\n\tst = !sh -c evil\n',
    '[filter "evil"]\n\tclean = evil\n',
    '[diff "x"]\n\ttextconv = evil\n',
    '[diff "x"]\n\tcommand = evil\n',
    '[credential]\n\thelper = !evil\n',
    '[include]\n\tpath = ../evil\n',
    '[gpg "ssh"]\n\tdefaultKeyCommand = evil\n',
    '[annex]\n\tfreeze-command = evil\n',
    '[datalad "result-hook.x"]\n\tcall-json = evil\n',
    '[protocol "ext"]\n\tallow = always\n',
    '[submodule "s"]\n\tupdate = !evil\n',
    '[remote "o"]\n\turl = ext::sh -c evil\n'
  ]) {
    assert.ok((await findExecVectors(await repo({ config: snippet }))).length > 0, `not flagged: ${snippet}`)
  }
})

test('a filter named annex with a different command is flagged', async () => {
  assert.match(await flagged(await repo({ config: '[filter "annex"]\n\tsmudge = evil\n' })), /filter\.annex\.smudge/)
})

test('a linked worktree is judged by the shared config git actually uses', async () => {
  const main = await repo({ config: '[core]\n\tsshCommand = evil\n' })
  git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x')
  const wt = join(await realpath(await mkdtemp(join(tmpdir(), 'trust-wt-'))), 'wt')
  git(main, 'worktree', 'add', '-q', wt)
  const out = await flagged(wt)
  assert.match(out, /core\.sshcommand/)
})

test('opening a subfolder judges the repository that contains it', async () => {
  const dir = await repo({ config: '[core]\n\tsshCommand = evil\n' })
  await mkdir(join(dir, 'deep', 'er'), { recursive: true })
  assert.match(await flagged(join(dir, 'deep', 'er')), /core\.sshcommand/)
})

test('a registered subdataset is scanned too, and reported with its path', async () => {
  const dir = await repo()
  const sub = join(dir, 'sub-01')
  await mkdir(sub)
  git(sub, 'init', '-q')
  appendFileSync(join(sub, '.git', 'config'), '[core]\n\tsshCommand = evil\n')
  await writeFile(join(dir, '.gitmodules'), '[submodule "sub-01"]\n\tpath = sub-01\n\turl = ./sub-01\n')
  assert.match(await flagged(dir), /sub-01: config core\.sshcommand/)
})

test('a folder that is not a repository has no vectors', async () => {
  assert.deepEqual(await findExecVectors(await mkdtemp(join(tmpdir(), 'trust-none-'))), [])
})

test('trust covers the findings the user saw, and a new finding asks again', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'trust-store-')), 'trusted.json')
  const target = await repo()
  createTrustStore(file).add(target, ['config a'])
  assert.equal(createTrustStore(file).accepts(target, ['config a']), true)
  assert.equal(createTrustStore(file).accepts(target, ['config a', 'config b']), false)
  assert.equal(createTrustStore(file).accepts(target, []), true)
  assert.equal(createTrustStore(file).accepts(await repo(), ['config a']), false)
})

test('an old path-only trust file trusts nothing', async () => {
  const target = await repo()
  const file = join(await mkdtemp(join(tmpdir(), 'trust-store-')), 'trusted.json')
  writeFileSync(file, JSON.stringify([target]))
  assert.equal(createTrustStore(file).accepts(target, ['config a']), false)
})

// The ground truth: what `datalad create` really writes on this OS must not be flagged
// (Windows CI runs this with real git-annex; a failure prints exactly which settings tripped it).
const hasDatalad = (() => {
  try {
    execFileSync('datalad', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

test('a freshly created DataLad dataset is not flagged', { skip: !hasDatalad && 'datalad not installed' }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'trust-real-')))
  const dir = join(root, 'ds')
  execFileSync('datalad', ['create', dir], {
    stdio: 'ignore',
    env: { ...process.env, GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x.io', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x.io' }
  })
  assert.deepEqual(await findExecVectors(dir), [])
})

test('a procedure shipped in .datalad/procedures is flagged', async () => {
  const dir = await repo()
  await mkdir(join(dir, '.datalad', 'procedures'), { recursive: true })
  await writeFile(join(dir, '.datalad', 'procedures', 'cfg_text2git.sh'), '#!/bin/sh\n')
  assert.match(await flagged(dir), /datalad procedure cfg_text2git\.sh/)
})

test('a not-yet-downloaded (dangling symlink) procedure is flagged too', { skip: process.platform === 'win32' && 'symlinks need privileges' }, async () => {
  const dir = await repo()
  await mkdir(join(dir, '.datalad', 'procedures'), { recursive: true })
  await symlink('../../.git/annex/objects/missing', join(dir, '.datalad', 'procedures', 'cfg_x.py'))
  assert.match(await flagged(dir), /datalad procedure cfg_x\.py/)
})

test('.datalad/config keys that name procedures or their locations are flagged', async () => {
  const dir = await repo()
  await mkdir(join(dir, '.datalad'), { recursive: true })
  await writeFile(join(dir, '.datalad', 'config'),
    '[datalad "dataset"]\n\tid = 1234\n[datalad "procedures.cfg_text2git"]\n\tcall-format = sh -c x\n[datalad "locations"]\n\tdataset-procedures = code\n')
  const out = await flagged(dir)
  assert.match(out, /datalad config datalad\.procedures\.cfg_text2git\.call-format/)
  assert.match(out, /datalad config datalad\.locations\.dataset-procedures/)
  assert.doesNotMatch(out, /datalad\.dataset\.id/)
})

test('an unparseable .datalad/config is flagged, not ignored', async () => {
  const dir = await repo()
  await mkdir(join(dir, '.datalad'), { recursive: true })
  await writeFile(join(dir, '.datalad', 'config'), '[broken\n')
  assert.match(await flagged(dir), /datalad config \(unreadable\)/)
})

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
  for (let i = 0; i < 3; i++) {
    const d = join(top, `r${i}`)
    await mkdir(d)
    git(d, 'init', '-q')
  }
  assert.match((await findExecVectors(top, { maxRepos: 2 })).join('\n'), /not fully scanned/)
  assert.match((await findExecVectors(top, { maxEntries: 2 })).join('\n'), /not fully scanned/)
})

test("a repository's own hook is no longer reported: hooks never run", async () => {
  const dir = await repo({ hooks: { 'pre-commit': '#!/bin/sh\necho hi\n' } })
  assert.deepEqual(await findExecVectors(dir), [])
})

// git-annex runs these two hooks itself, from the repository's own .git/hooks, and ignores core.hooksPath.
test("git-annex's own per-repository hooks are reported, with a fingerprint of their content", async () => {
  const dir = await repo({ hooks: { 'pre-commit-annex': '#!/bin/sh\nevil\n', 'post-update-annex': '#!/bin/sh\nevil\n' } })
  const out = await flagged(dir)
  assert.match(out, /hook pre-commit-annex [0-9a-f]{64}/)
  assert.match(out, /hook post-update-annex [0-9a-f]{64}/)
  const changed = await repo({ hooks: { 'pre-commit-annex': '#!/bin/sh\nsomething else\n' } })
  assert.notEqual((await flagged(changed)).match(/hook pre-commit-annex ([0-9a-f]{64})/)[1], out.match(/hook pre-commit-annex ([0-9a-f]{64})/)[1])
})

test('the stock git-annex hooks and other hooks (which never run) are not reported', async () => {
  const dir = await repo({ hooks: { 'pre-commit': ANNEX_PRE_COMMIT, 'post-commit': '#!/bin/sh\necho hi\n' } })
  assert.deepEqual(await findExecVectors(dir), [])
})

// On a case-insensitive filesystem (macOS, Windows) git uses a folder named .GIT or .Git as the repository.
test('a nested repository whose git folder is named .GIT is scanned', async () => {
  const top = await realpath(await mkdtemp(join(tmpdir(), 'trust-')))
  const sub = join(top, 'sub-01')
  await mkdir(sub)
  git(sub, 'init', '-q')
  appendFileSync(join(sub, '.git', 'config'), '[filter "x"]\n\tclean = y\n')
  await rename(join(sub, '.git'), join(sub, '.GIT'))
  let gitSeesIt = true
  try {
    git(sub, 'rev-parse', '--git-dir')
  } catch {
    gitSeesIt = false // case-sensitive filesystem: git ignores .GIT too, so there is nothing to find
  }
  if (!gitSeesIt) return
  assert.match(await flagged(top), /sub-01: config filter\.x\.clean/)
})

test('a finding names the value, so a changed command is a new finding', async () => {
  const one = await flagged(await repo({ config: '[core]\n\tsshCommand = evil one\n' }))
  const two = await flagged(await repo({ config: '[core]\n\tsshCommand = evil two\n' }))
  assert.match(one, /config core\.sshcommand = evil one/)
  assert.notEqual(one, two)
})

test('the dialog text lists "not fully scanned" first, caps the rest, and flattens each finding to one line', () => {
  const vectors = ['config a = 1\n2', 'config b', 'config c', 'config d', 'config e', 'config f', 'not fully scanned (more than 3 repositories)']
  const lines = describeVectors(vectors).split('\n')
  assert.match(lines[0], /not fully scanned/)
  assert.equal(lines.length, 6)
  assert.match(lines.at(-1), /and 2 more/)
  assert.ok(!describeVectors(['config x = ' + 'y'.repeat(500)]).includes('y'.repeat(200)))
  assert.ok(!describeVectors(vectors).includes('1\n2'))
})

test('"not fully scanned" is accepted for this session only, never remembered across launches', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'trust-store-')), 'trusted.json')
  const target = await repo()
  const vectors = ['config a = 1', 'not fully scanned (more than 3 repositories)']
  const store = createTrustStore(file)
  store.add(target, vectors)
  assert.equal(store.accepts(target, vectors), true)
  assert.equal(createTrustStore(file).accepts(target, vectors), false)
  assert.equal(createTrustStore(file).accepts(target, ['config a = 1']), true)
})

const ANNEX_HOOK_NAMES = ['pre-commit-annex', 'post-update-annex', 'freezecontent-annex', 'thawcontent-annex', 'secure-erase-annex', 'commitmessage-annex', 'http-headers-annex', 'pre-init-annex']
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

test('every git-annex hook name is reported', async () => {
  const hooks = Object.fromEntries(ANNEX_HOOK_NAMES.map((name) => [name, '#!/bin/sh\n:\n']))
  const out = await flagged(await repo({ hooks }))
  for (const name of ANNEX_HOOK_NAMES) assert.match(out, new RegExp(`hook ${name} [0-9a-f]{64}`), name)
})

// git-annex reads hooks from the git dir of the work tree it runs in, not only from the shared one.
test("hooks in a linked worktree's own git dir are reported", async () => {
  const main = await repo()
  git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x')
  const wt = join(await realpath(await mkdtemp(join(tmpdir(), 'trust-wt-'))), 'wt')
  git(main, 'worktree', 'add', '-q', wt)
  await hook(join(main, '.git', 'worktrees', 'wt'), 'freezecontent-annex', '#!/bin/sh\n:\n')
  assert.match(await flagged(wt), /hook freezecontent-annex [0-9a-f]{64}/)
})

// Executing a hook only needs the x bit on its folder, so a folder git-annex can use may not be listable.
test('a hooks folder that cannot be listed is still checked, hook by hook', { skip: (process.platform === 'win32' || isRoot) && 'needs POSIX permissions and a non-root user' }, async () => {
  const dir = await repo({ hooks: { 'freezecontent-annex': '#!/bin/sh\n:\n' } })
  await chmod(join(dir, '.git', 'hooks'), 0o311)
  try {
    const out = await flagged(dir)
    assert.match(out, /hook freezecontent-annex [0-9a-f]{64}/)
    assert.match(out, /not fully scanned/)
  } finally {
    await chmod(join(dir, '.git', 'hooks'), 0o755)
  }
})

test('a hook that cannot be read is a not-fully-scanned finding, not a fingerprint', { skip: (process.platform === 'win32' || isRoot) && 'needs POSIX permissions and a non-root user' }, async () => {
  const dir = await repo({ hooks: { 'pre-commit-annex': '#!/bin/sh\n:\n' } })
  await chmod(join(dir, '.git', 'hooks', 'pre-commit-annex'), 0o111)
  const out = await flagged(dir)
  assert.match(out, /not fully scanned \(cannot read hook pre-commit-annex/)
  assert.doesNotMatch(out, /hook pre-commit-annex [0-9a-f]{64}/)
})

// Push (datalad push) makes git-annex run the REMOTE repository's own hooks when the remote is a local path.
const withRemote = async ({ hooks = { 'freezecontent-annex': '#!/bin/sh\n:\n' }, bare = false, url = (path) => path, config = '' } = {}) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'trust-remote-')))
  const remote = join(base, 'R')
  if (bare) {
    git(base, 'init', '-q', '--bare', remote)
    await hook(remote, 'freezecontent-annex', hooks['freezecontent-annex'])
  } else {
    await mkdir(remote)
    git(remote, 'init', '-q')
    for (const [name, body] of Object.entries(hooks)) await hook(join(remote, '.git'), name, body)
  }
  const clone = join(base, 'C')
  await mkdir(clone)
  git(clone, 'init', '-q')
  appendFileSync(join(clone, '.git', 'config'), `${config}[remote "origin"]\n\turl = ${url(remote)}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`)
  return { base, remote, clone }
}

test("a local-path remote's git-annex hooks are reported before a push", async () => {
  const { clone, remote } = await withRemote()
  const out = await flagged(clone)
  assert.match(out, /remote origin/)
  assert.ok(out.includes(remote))
  assert.match(out, /hook freezecontent-annex [0-9a-f]{64}/)
})

test('file:// and relative remote URLs are local paths too', async () => {
  for (const url of [(path) => `file://${path}`, () => '../R']) {
    const { clone } = await withRemote({ url })
    assert.match(await flagged(clone), /hook freezecontent-annex/, String(url))
  }
})

test('a bare remote is checked', async () => {
  const { clone } = await withRemote({ bare: true })
  assert.match(await flagged(clone), /hook freezecontent-annex [0-9a-f]{64}/)
})

test('a url.insteadOf rewrite to a local path is followed', async () => {
  const { clone, base } = await withRemote({ url: () => 'lab:R' })
  appendFileSync(join(clone, '.git', 'config'), `[url "${base}/"]\n\tinsteadOf = lab:\n`)
  assert.match(await flagged(clone), /hook freezecontent-annex/)
})

test('network remotes are not local paths, and an unplugged local remote is not a finding', async () => {
  for (const url of ['git@example.invalid:lab/ds.git', 'ssh://example.invalid/lab/ds', 'https://example.invalid/ds.git']) {
    const { clone } = await withRemote({ url: () => url })
    assert.deepEqual(await findExecVectors(clone), [], url)
  }
  const { clone } = await withRemote({ url: () => join(tmpdir(), 'trust-no-such-share', 'ds') })
  assert.deepEqual(await findExecVectors(clone), [])
})

// git can refuse a folder owned by someone else (the usual case on a shared drive), so the layouts are also read directly.
test("a remote that git itself will not open is still checked by looking at its hooks folders", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'trust-remote-')))
  const remote = join(base, 'R')
  await mkdir(remote)
  await hook(join(remote, '.git'), 'post-update-annex', '#!/bin/sh\n:\n') // a .git folder git cannot use: no HEAD, no objects
  const clone = join(base, 'C')
  await mkdir(clone)
  git(clone, 'init', '-q')
  appendFileSync(join(clone, '.git', 'config'), `[remote "origin"]\n\turl = ${remote}\n`)
  assert.match(await flagged(clone), /hook post-update-annex [0-9a-f]{64}/)
})
