// Real git and the real runner (no fake), like own-tags-real-git.test.js: merge behaviour is git's, so it is checked there.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataLadAdapter } from '../src/datalad/adapter.js'
import { ProcessRunner } from '../src/datalad/process-runner.js'

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'dlad-merge-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'ana@example.org')
  git('config', 'user.name', 'Ana')
  git('config', 'commit.gpgsign', 'false')
  return { dir, git, write: (name, text) => writeFile(join(dir, name), text), adapter: new DataLadAdapter({ runner: new ProcessRunner() }) }
}

// main and feature both changed file.txt: the classic conflict. Left on main.
async function conflictingRepo(fileName = 'file.txt') {
  const r = await makeRepo()
  await r.write(fileName, 'base\n')
  r.git('add', '--', '.')
  r.git('commit', '-qm', 'base')
  r.git('checkout', '-qb', 'feature')
  await r.write(fileName, 'feature\n')
  r.git('commit', '-qam', 'feature edit')
  r.git('checkout', '-q', 'main')
  await r.write(fileName, 'main\n')
  r.git('commit', '-qam', 'main edit')
  return r
}

const merge = (r, branchName = 'feature') => r.adapter.runCommand('merge', { projectPath: r.dir, branchName })
const text = (r, name = 'file.txt') => readFile(join(r.dir, name), 'utf8')

test('merging a branch that is ahead fast-forwards', async () => {
  const r = await makeRepo()
  await r.write('a.txt', 'a\n')
  r.git('add', '--', '.')
  r.git('commit', '-qm', 'base')
  r.git('checkout', '-qb', 'feature')
  await r.write('b.txt', 'b\n')
  r.git('add', '--', '.')
  r.git('commit', '-qm', 'more')
  r.git('checkout', '-q', 'main')

  const result = await merge(r)
  assert.equal(result.ok, true, result.stderr)
  assert.equal(await text(r, 'b.txt'), 'b\n')
})

test('merging branches that changed different files makes a merge commit', async () => {
  const r = await makeRepo()
  await r.write('a.txt', 'a\n')
  r.git('add', '--', '.')
  r.git('commit', '-qm', 'base')
  r.git('checkout', '-qb', 'feature')
  await r.write('b.txt', 'b\n')
  r.git('add', '--', '.')
  r.git('commit', '-qm', 'feature')
  r.git('checkout', '-q', 'main')
  await r.write('a.txt', 'a2\n')
  r.git('commit', '-qam', 'main')

  const result = await merge(r)
  assert.equal(result.ok, true, result.stderr)
  assert.match(r.git('log', '-1', '--format=%s'), /^Merge branch 'feature'/)
})
