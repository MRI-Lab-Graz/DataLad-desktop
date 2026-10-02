import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProcessRunner } from '../src/datalad/process-runner.js'
import { listDirectory } from '../src/gui/list-directory.js'

const runner = new ProcessRunner()
const run = (command, args, options) => runner.run(command, args, options)

function git(cwd, ...args) {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' })
}

async function project() {
  const root = join(await realpath(await mkdtemp(join(tmpdir(), 'listdir-'))), 'proj')
  await mkdir(join(root, 'code', 'deep'), { recursive: true })
  await writeFile(join(root, 'README.md'), 'readme')
  await writeFile(join(root, 'code', 'a.txt'), 'a')
  await writeFile(join(root, 'code', 'deep', 'b.txt'), 'b')
  git(root, 'init', '-q')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'init')
  return root
}

const byName = (listing) => Object.fromEntries(listing.entries.map((entry) => [entry.name, entry]))

test('listDirectory returns only the direct children, never grandchildren', async () => {
  const root = await project()
  const listing = await listDirectory({ rootPath: root, run })

  assert.deepEqual(listing.entries.map((entry) => entry.name).sort(), ['README.md', 'code'])
  assert.equal(byName(listing).code.type, 'directory')
  assert.equal(byName(listing)['README.md'].type, 'file')
  assert.equal(listing.truncated, false)
})

test('listDirectory skips .git and other internal folders', async () => {
  const root = await project()
  await mkdir(join(root, '.datalad'))
  const listing = await listDirectory({ rootPath: root, run })

  assert.equal(listing.entries.some((entry) => entry.name === '.git' || entry.name === '.datalad'), false)
})

test('listDirectory of a subfolder reports paths relative to the project root', async () => {
  const root = await project()
  const listing = await listDirectory({ rootPath: root, dirPath: join(root, 'code'), run })

  assert.deepEqual(listing.entries.map((entry) => entry.relativePath).sort(), ['code/a.txt', 'code/deep'])
  assert.equal(listing.rootPath, root)
})

test('listDirectory reports file status and rolls it up onto folders', async () => {
  const root = await project()
  await writeFile(join(root, 'code', 'a.txt'), 'changed')
  await writeFile(join(root, 'code', 'deep', 'new.txt'), 'new')

  const top = byName(await listDirectory({ rootPath: root, run }))
  assert.equal(top.code.gitStatus, 'changed')
  assert.equal(top['README.md'].gitStatus, null)

  const code = byName(await listDirectory({ rootPath: root, dirPath: join(root, 'code'), run }))
  assert.equal(code['a.txt'].gitStatus, 'modified')
  assert.equal(code.deep.gitStatus, 'changed')
})

test('listDirectory takes status from the nearest repository, so nested datasets work', async () => {
  const root = await project()
  const sub = join(root, 'sub-001')
  await mkdir(sub)
  await writeFile(join(sub, 'scan.nii'), 'x')
  git(sub, 'init', '-q')
  git(sub, 'add', '.')
  git(sub, 'commit', '-q', '-m', 'sub')
  await writeFile(join(sub, 'scan.nii'), 'edited')

  const listing = await listDirectory({ rootPath: root, dirPath: sub, run })
  assert.equal(byName(listing)['scan.nii'].gitStatus, 'modified')
})

test('listDirectory caps a huge folder and says so', async () => {
  const root = await project()
  for (let i = 0; i < 5; i += 1) {
    await writeFile(join(root, `f${i}.txt`), String(i))
  }
  const listing = await listDirectory({ rootPath: root, run, maxEntries: 3 })

  assert.equal(listing.entries.length, 3)
  assert.equal(listing.truncated, true)
})

test('listDirectory refuses a folder outside the project root', async () => {
  const root = await project()
  await assert.rejects(listDirectory({ rootPath: root, dirPath: join(root, '..'), run }), /outside/i)
})
