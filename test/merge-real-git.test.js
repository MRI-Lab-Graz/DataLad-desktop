// Real git and the real runner (no fake), like own-tags-real-git.test.js: merge behaviour is git's, so it is checked there.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataLadAdapter } from '../src/datalad/adapter.js'
import { ProcessRunner } from '../src/datalad/process-runner.js'

const hasDatalad = (() => { try { execFileSync('datalad', ['--version'], { stdio: 'ignore' }); return true } catch { return false } })()

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'dlad-merge-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'ana@example.org')
  git('config', 'user.name', 'Ana')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'core.autocrlf', 'false')
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

test('a conflicting merge is ok with conflicts: true and leaves the merge open', async () => {
  const r = await conflictingRepo()
  const result = await merge(r)
  assert.equal(result.ok, true)
  assert.equal(result.conflicts, true)
  assert.match(await text(r), /<<<<<<< /)
})

test('merge refuses on a detached HEAD', async () => {
  const r = await conflictingRepo()
  r.git('checkout', '-q', '--detach')
  const result = await merge(r)
  assert.equal(result.ok, false)
  assert.equal(result.userError.code, 'DETACHED_HEAD')
})

test('merge refuses while a merge is already open', async () => {
  const r = await conflictingRepo()
  await merge(r)
  const again = await merge(r)
  assert.equal(again.ok, false)
  assert.equal(again.userError.code, 'MERGE_IN_PROGRESS')
})

test('unrelated histories are refused in plain language', async () => {
  const r = await conflictingRepo()
  r.git('checkout', '-q', '--orphan', 'other')
  r.git('rm', '-rfq', '--', '.')
  await r.write('x.txt', 'x\n')
  r.git('add', '--', '.')
  r.git('commit', '-qm', 'unrelated root')
  r.git('checkout', '-q', 'main')
  const result = await merge(r, 'other')
  assert.equal(result.ok, false)
  assert.equal(result.userError.code, 'MERGE_UNRELATED')
})

test('an untracked file the merge would overwrite is refused and named', async () => {
  const r = await makeRepo()
  await r.write('a.txt', 'a\n')
  r.git('add', '--', '.')
  r.git('commit', '-qm', 'base')
  r.git('checkout', '-qb', 'feature')
  await r.write('new.txt', 'from feature\n')
  r.git('add', '--', '.')
  r.git('commit', '-qm', 'adds new.txt')
  r.git('checkout', '-q', 'main')
  await r.write('new.txt', 'mine, never saved\n')
  const result = await merge(r)
  assert.equal(result.ok, false)
  assert.equal(result.userError.code, 'MERGE_UNTRACKED_OVERWRITE')
  assert.match(result.userError.technicalDetails, /new\.txt/)
})

test('the status reports an open merge, the other branch and which sides exist', async () => {
  const r = await conflictingRepo()
  await merge(r)
  const status = await r.adapter.getWorkingTreeStatus(r.dir)
  assert.equal(status.mergeInProgress, true)
  assert.equal(status.mergeBranch, 'feature')
  const file = status.files.find((f) => f.path === 'file.txt')
  assert.equal(file.conflicted, true)
  assert.deepEqual(file.sides, { ours: true, theirs: true })
})

test('the status of an ordinary project says no merge is open', async () => {
  const r = await conflictingRepo()
  const status = await r.adapter.getWorkingTreeStatus(r.dir)
  assert.equal(status.mergeInProgress, false)
  assert.equal(status.mergeBranch, null)
})

const resolve = (r, path, side) => r.adapter.resolveConflict(r.dir, path, side)
const finish = (r) => r.adapter.runCommand('finishMerge', { projectPath: r.dir })

test('keeping this branch\'s version, then finishing, saves the merge with that text', async () => {
  const r = await conflictingRepo()
  await merge(r)
  await resolve(r, 'file.txt', 'ours')
  const done = await finish(r)
  assert.equal(done.ok, true, done.stderr)
  assert.equal(await text(r), 'main\n')
  assert.equal((await r.adapter.getWorkingTreeStatus(r.dir)).mergeInProgress, false)
})

test('keeping the other branch\'s version', async () => {
  const r = await conflictingRepo()
  await merge(r)
  await resolve(r, 'file.txt', 'theirs')
  assert.equal((await finish(r)).ok, true)
  assert.equal(await text(r), 'feature\n')
})

test('a file with spaces and a leading dash resolves like any other', async () => {
  const r = await conflictingRepo('-odd name.txt')
  await merge(r)
  await resolve(r, '-odd name.txt', 'theirs')
  assert.equal((await finish(r)).ok, true)
  assert.equal(await text(r, '-odd name.txt'), 'feature\n')
})

test('finishing with a file still undecided is refused in plain language', async () => {
  const r = await conflictingRepo()
  await merge(r)
  const done = await finish(r)
  assert.equal(done.ok, false)
  assert.equal(done.userError.code, 'MERGE_UNRESOLVED')
})

test('when the other branch deleted the file, keeping its version removes it; keeping ours keeps it', async () => {
  for (const [side, expectFile] of [['theirs', false], ['ours', true]]) {
    const r = await makeRepo()
    await r.write('file.txt', 'base\n')
    await r.write('other.txt', 'o\n')
    r.git('add', '--', '.')
    r.git('commit', '-qm', 'base')
    r.git('checkout', '-qb', 'feature')
    r.git('rm', '-q', '--', 'file.txt')
    r.git('commit', '-qm', 'delete')
    r.git('checkout', '-q', 'main')
    await r.write('file.txt', 'edited on main\n')
    r.git('commit', '-qam', 'edit')
    await merge(r)
    const status = await r.adapter.getWorkingTreeStatus(r.dir)
    assert.deepEqual(status.files.find((f) => f.path === 'file.txt').sides, { ours: true, theirs: false })
    await resolve(r, 'file.txt', side)
    assert.equal((await finish(r)).ok, true)
    assert.equal(r.git('ls-files', '--', 'file.txt').trim() === 'file.txt', expectFile)
  }
})

test('"I fixed it myself" is refused while conflict markers remain, accepted once they are gone', async () => {
  const r = await conflictingRepo()
  await merge(r)
  await assert.rejects(resolve(r, 'file.txt', 'manual'), /conflict markers/)
  await r.write('file.txt', 'combined by hand\n')
  await resolve(r, 'file.txt', 'manual')
  assert.equal((await finish(r)).ok, true)
  assert.equal(await text(r), 'combined by hand\n')
})

test('a Markdown file with a ======= underline is not mistaken for a conflict', async () => {
  const r = await conflictingRepo()
  await merge(r)
  await r.write('file.txt', 'Title\n=======\nbody\n')
  await resolve(r, 'file.txt', 'manual')
})

test('only a file that is in conflict can be resolved, and only with a known side', async () => {
  const r = await conflictingRepo()
  await merge(r)
  await assert.rejects(resolve(r, 'nope.txt', 'ours'), /not in conflict/)
  await assert.rejects(resolve(r, 'file.txt', 'both'), /Invalid side/)
})

test('Cancel Merge puts the project back as it was', async () => {
  const r = await conflictingRepo()
  await merge(r)
  const aborted = await r.adapter.runCommand('abortMerge', { projectPath: r.dir })
  assert.equal(aborted.ok, true, aborted.stderr)
  assert.equal(await text(r), 'main\n')
  assert.equal((await r.adapter.getWorkingTreeStatus(r.dir)).mergeInProgress, false)
})

// A parent project with one submodule "sub" whose checkout has its own identity configured.
async function repoWithSub() {
  const origin = await makeRepo()
  await origin.write('s.txt', '1\n')
  origin.git('add', '--', '.')
  origin.git('commit', '-qm', 's1')
  const r = await makeRepo()
  await r.write('a.txt', 'a\n')
  r.git('add', '--', '.')
  r.git('commit', '-qm', 'base')
  r.git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', origin.dir, 'sub')
  r.git('commit', '-qm', 'add sub')
  r.git('-C', 'sub', 'config', 'user.email', 'ana@example.org')
  r.git('-C', 'sub', 'config', 'user.name', 'Ana')
  r.git('-C', 'sub', 'config', 'commit.gpgsign', 'false')
  const subHead = () => r.git('-C', 'sub', 'rev-parse', 'HEAD').trim()
  return { r, subHead, c1: subHead() }
}

// The parent records a newer subdataset commit than the one checked out (what a merge leaves behind).
async function parentRecordsNewerSub({ dirtySub = false } = {}) {
  const { r, subHead, c1 } = await repoWithSub()
  await writeFile(join(r.dir, 'sub', 's.txt'), '2\n')
  r.git('-C', 'sub', 'commit', '-qam', 's2')
  const c2 = subHead()
  r.git('add', '--', 'sub')
  r.git('commit', '-qm', 'record s2')
  r.git('-C', 'sub', 'checkout', '-q', '--detach', c1)
  if (dirtySub) {
    await writeFile(join(r.dir, 'sub', 's.txt'), 'unsaved work\n')
  }
  return { r, subHead, c1, c2 }
}

test('a subdataset checkout is moved to the commit the merge recorded', async () => {
  const { r, subHead, c2 } = await parentRecordsNewerSub()
  const warnings = await r.adapter.syncSubdatasets(r.dir)
  assert.deepEqual(warnings, [])
  assert.equal(subHead(), c2)
})

test('a subdataset with unsaved work is left alone and the researcher is told', async () => {
  const { r, subHead, c1 } = await parentRecordsNewerSub({ dirtySub: true })
  const warnings = await r.adapter.syncSubdatasets(r.dir)
  assert.equal(subHead(), c1)
  assert.equal(await readFile(join(r.dir, 'sub', 's.txt'), 'utf8'), 'unsaved work\n')
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0].code, 'SUBDATASET_NOT_MOVED')
  assert.match(warnings[0].message, /sub/)
})

test('a subdataset whose recorded commit is not a fast-forward is left alone', async () => {
  const { r, subHead, c1 } = await repoWithSub()
  await writeFile(join(r.dir, 'sub', 's.txt'), 'mine\n')
  r.git('-C', 'sub', 'commit', '-qam', 'my own commit')
  const mine = subHead()
  r.git('-C', 'sub', 'checkout', '-q', '--detach', c1)
  await writeFile(join(r.dir, 'sub', 's.txt'), 'theirs\n')
  r.git('-C', 'sub', 'commit', '-qam', 'diverging commit')
  r.git('add', '--', 'sub')
  r.git('commit', '-qm', 'record diverging commit')
  r.git('-C', 'sub', 'checkout', '-q', '--detach', mine)
  const warnings = await r.adapter.syncSubdatasets(r.dir)
  assert.equal(subHead(), mine)
  assert.equal(warnings[0]?.code, 'SUBDATASET_NOT_MOVED')
})

test('finishing a merge that brings a newer subdataset commit moves the checkout', async () => {
  const { r, subHead, c1 } = await repoWithSub()
  r.git('checkout', '-qb', 'feature')
  await writeFile(join(r.dir, 'sub', 's.txt'), '2\n')
  r.git('-C', 'sub', 'commit', '-qam', 's2')
  const c2 = subHead()
  r.git('add', '--', 'sub')
  r.git('commit', '-qm', 'bump sub')
  r.git('checkout', '-q', 'main')
  r.git('-C', 'sub', 'checkout', '-q', '--detach', c1)
  await r.write('a.txt', 'a2\n')
  r.git('commit', '-qam', 'main edit')

  const result = await merge(r)
  assert.equal(result.ok, true, result.stderr)
  assert.equal(subHead(), c2)
})

test('a subdataset conflict is resolved by recording the chosen commit', async () => {
  const { r, subHead, c1 } = await repoWithSub()
  r.git('checkout', '-qb', 'feature')
  await writeFile(join(r.dir, 'sub', 's.txt'), 'feature side\n')
  r.git('-C', 'sub', 'commit', '-qam', 'feature sub')
  const theirs = subHead()
  r.git('add', '--', 'sub')
  r.git('commit', '-qm', 'feature bumps sub')
  r.git('checkout', '-q', 'main')
  r.git('-C', 'sub', 'checkout', '-q', '--detach', c1)
  await writeFile(join(r.dir, 'sub', 's.txt'), 'main side\n')
  r.git('-C', 'sub', 'commit', '-qam', 'main sub')
  r.git('add', '--', 'sub')
  r.git('commit', '-qm', 'main bumps sub')

  const started = await merge(r)
  assert.equal(started.conflicts, true)
  const status = await r.adapter.getWorkingTreeStatus(r.dir)
  assert.deepEqual(status.files.find((f) => f.path === 'sub').sides, { ours: true, theirs: true })
  await r.adapter.resolveConflict(r.dir, 'sub', 'theirs')
  const done = await r.adapter.runCommand('finishMerge', { projectPath: r.dir })
  assert.equal(done.ok, true, done.stderr)
  assert.equal(r.git('ls-tree', 'HEAD', '--', 'sub').split(/\s+/)[2], theirs)
  assert.equal(done.warnings[0]?.code, 'SUBDATASET_NOT_MOVED') // the checkout holds this branch's own commit
})

test('a conflict on an annexed file is resolved by picking a side', { skip: (!hasDatalad || process.platform === 'win32') && 'needs datalad on POSIX' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dlad-merge-annex-'))
  const sh = (cmd, ...args) => execFileSync(cmd, args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
  sh('datalad', 'create', '--', '.')
  await writeFile(join(dir, 'big.bin'), 'base'.repeat(100))
  sh('datalad', 'save', '-m', 'base')
  sh('git', 'checkout', '-qb', 'feature')
  await rm(join(dir, 'big.bin'), { force: true })
  await writeFile(join(dir, 'big.bin'), 'feature'.repeat(100))
  sh('datalad', 'save', '-m', 'feature')
  sh('git', 'checkout', '-q', 'main')
  await rm(join(dir, 'big.bin'), { force: true })
  await writeFile(join(dir, 'big.bin'), 'main'.repeat(100))
  sh('datalad', 'save', '-m', 'main')

  const adapter = new DataLadAdapter({ runner: new ProcessRunner() })
  const started = await adapter.runCommand('merge', { projectPath: dir, branchName: 'feature' })
  assert.equal(started.conflicts, true, started.stderr)
  await adapter.resolveConflict(dir, 'big.bin', 'theirs')
  const done = await adapter.runCommand('finishMerge', { projectPath: dir })
  assert.equal(done.ok, true, done.stderr)
  assert.equal(await readFile(join(dir, 'big.bin'), 'utf8'), 'feature'.repeat(100))
})

// The banner takes its paths from getWorkingTreeStatus, so names git quotes in porcelain (space, ") must come back raw.
const oddNames = [['my notes.txt'], ['Übersicht.txt']]
if (process.platform !== 'win32') {
  oddNames.push(['say "hi".txt'])
}
for (const [name] of oddNames) {
  test(`a conflict on ${name} is resolved with the path the status reports`, async () => {
    const r = await conflictingRepo(name)
    await merge(r)
    const status = await r.adapter.getWorkingTreeStatus(r.dir)
    assert.equal(status.conflicts.length, 1)
    const conflict = status.conflicts[0]
    assert.equal(conflict.path, name)
    assert.deepEqual(conflict.sides, { ours: true, theirs: true })
    await resolve(r, conflict.path, 'theirs')
    const done = await finish(r)
    assert.equal(done.ok, true, done.stderr)
    assert.equal(await text(r, name), 'feature\n')
    assert.deepEqual((await r.adapter.getWorkingTreeStatus(r.dir)).conflicts, [])
  })
}
