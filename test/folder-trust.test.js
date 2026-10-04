import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, chmod, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findExecVectors, createTrustStore } from '../src/gui/folder-trust.js'

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
