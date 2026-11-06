// Real git and git-annex: presence and size come from git-annex itself.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
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

test('listDataFiles prefixes subdataset paths and skips a subdataset without annex', { skip: !hasAnnex && 'git-annex is not installed' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dlad-list-annex-sub-'))
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
  const setup = (cwd) => {
    git(cwd, 'init', '-q', '-b', 'main')
    git(cwd, 'config', 'user.email', 'ana@example.org')
    git(cwd, 'config', 'user.name', 'Ana')
    git(cwd, 'config', 'commit.gpgsign', 'false')
  }
  setup(dir)
  await mkdir(join(dir, 'sub-01'))
  await mkdir(join(dir, 'plain'))
  setup(join(dir, 'sub-01'))
  setup(join(dir, 'plain'))
  git(join(dir, 'sub-01'), 'annex', 'init', 'test')
  await writeFile(join(dir, 'sub-01', 'scan.nii'), 'abc')
  git(join(dir, 'sub-01'), 'annex', 'add', 'scan.nii')
  git(join(dir, 'sub-01'), 'commit', '-qm', 'scan')
  await writeFile(join(dir, 'plain', 'a.txt'), 'x')
  git(join(dir, 'plain'), 'add', 'a.txt')
  git(join(dir, 'plain'), 'commit', '-qm', 'a')
  git(dir, 'submodule', 'add', './sub-01')
  git(dir, 'submodule', 'add', './plain')

  const files = await new DataLadAdapter({ runner: new ProcessRunner() }).listDataFiles(dir)

  assert.deepEqual(files, [{ path: 'sub-01/scan.nii', present: true, bytes: 3 }])
})
