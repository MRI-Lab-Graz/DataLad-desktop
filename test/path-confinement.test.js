import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isWithinRoots, initialAuthorizedRoots } from '../src/gui/path-confinement.js'

async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'confine-')))
  const root = join(base, 'root')
  const outside = join(base, 'outside')
  await mkdir(join(root, 'sub'), { recursive: true })
  await mkdir(outside)
  return { base, root, outside }
}

test('isWithinRoots accepts the root itself, children, and not-yet-existing children', async () => {
  const { root } = await fixture()
  assert.equal(isWithinRoots(root, [root]), true)
  assert.equal(isWithinRoots(join(root, 'sub'), [root]), true)
  assert.equal(isWithinRoots(join(root, 'sub', 'new-file.txt'), [root]), true)
})

test('isWithinRoots rejects siblings that merely share the root as a string prefix', async () => {
  const { base, root } = await fixture()
  await mkdir(join(base, 'root-evil'))
  assert.equal(isWithinRoots(join(base, 'root-evil'), [root]), false)
})

test('isWithinRoots rejects .. escapes', async () => {
  const { root, outside } = await fixture()
  assert.equal(isWithinRoots(join(root, '..', 'outside'), [root]), false)
  assert.equal(isWithinRoots(outside, [root]), false)
})

test('isWithinRoots rejects a symlink inside the root that points outside it', async () => {
  const { root, outside } = await fixture()
  await symlink(outside, join(root, 'escape'), 'dir')
  assert.equal(isWithinRoots(join(root, 'escape'), [root]), false)
  assert.equal(isWithinRoots(join(root, 'escape', 'file.txt'), [root]), false)
})

test('isWithinRoots accepts a root given through a symlink', async () => {
  const { base, root } = await fixture()
  const alias = join(base, 'alias')
  await symlink(root, alias, 'dir')
  assert.equal(isWithinRoots(join(root, 'sub'), [alias]), true)
  assert.equal(isWithinRoots(join(alias, 'sub'), [root]), true)
})

test('initialAuthorizedRoots seeds the launch directory only for unpackaged (dev) runs', () => {
  assert.deepEqual([...initialAuthorizedRoots({ cwd: '/work/repo', isPackaged: false })], [resolve('/work/repo')])
  assert.deepEqual([...initialAuthorizedRoots({ cwd: '/', isPackaged: true })], [])
})
