// Real git and git-annex: presence and size come from git-annex itself.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataLadAdapter } from '../src/datalad/adapter.js'
import { ProcessRunner } from '../src/datalad/process-runner.js'

const hasAnnex = (() => { try { execFileSync('git', ['annex', 'version'], { stdio: 'ignore' }); return true } catch { return false } })()

test('listDataFiles reports a present and a dropped annexed file, and omits plain git files', { skip: !hasAnnex && 'git-annex is not installed' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dlad-list-annex-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'ana@example.org')
  git('config', 'user.name', 'Ana')
  git('config', 'commit.gpgsign', 'false')
  git('annex', 'init', 'test')
  await writeFile(join(dir, 'keep.dat'), 'twelve bytes')
  await writeFile(join(dir, 'ünï.dat'), 'will be dropped')
  git('annex', 'add', 'keep.dat', 'ünï.dat')
  await writeFile(join(dir, 'plain.txt'), 'x')
  git('add', 'plain.txt')
  git('commit', '-qm', 'files')
  git('annex', 'drop', '--force', 'ünï.dat')

  const files = await new DataLadAdapter({ runner: new ProcessRunner() }).listDataFiles(dir)

  assert.deepEqual(
    files.sort((a, b) => a.path.localeCompare(b.path)),
    [
      { path: 'keep.dat', present: true, bytes: 12 },
      { path: 'ünï.dat', present: false, bytes: 15 }
    ]
  )
})
