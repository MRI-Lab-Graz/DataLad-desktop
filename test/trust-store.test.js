import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { createTrustStore, identityOf } from '../src/gui/trust-store.js'

const scratch = async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'trust-store-')))
  return { base, file: join(base, 'trusted.json') }
}
const folder = async (base, name) => {
  const dir = join(base, name)
  await mkdir(dir, { recursive: true })
  return dir
}

test('nothing is trusted by default', async () => {
  const { base, file } = await scratch()
  const store = createTrustStore({ file })
  const dir = await folder(base, 'ds')
  assert.equal(store.covers(dir), false)
  assert.equal(store.decide(dir, []).trusted, false)
})

test('a folder record trusts that folder for the findings the user saw, and a new finding asks again', async () => {
  const { base, file } = await scratch()
  const dir = await folder(base, 'ds')
  createTrustStore({ file }).trust(dir, { scope: 'folder', vectors: ['config a = 1'] })
  const store = createTrustStore({ file })
  assert.equal(store.decide(dir, ['config a = 1']).trusted, true)
  assert.equal(store.decide(dir, []).trusted, true)
  assert.equal(store.decide(dir, ['config a = 1', 'config b = 2']).trusted, false)
  assert.equal(store.covers(dir), false)
})

test('a folder record does not cover the folders inside it', async () => {
  const { base, file } = await scratch()
  const dir = await folder(base, 'ds')
  const inner = await folder(base, 'ds/inner')
  const store = createTrustStore({ file })
  store.trust(dir, { scope: 'folder' })
  assert.equal(store.covers(inner), false)
  assert.equal(store.decide(inner, []).trusted, false)
})

test('a tree record covers the folder and everything inside it, but not a sibling that shares a name prefix', async () => {
  const { base, file } = await scratch()
  const share = await folder(base, 'share')
  const inner = await folder(base, 'share/lab/ds')
  const lookalike = await folder(base, 'share-other')
  createTrustStore({ file }).trust(share, { scope: 'tree' })
  const store = createTrustStore({ file })
  assert.equal(store.covers(share), true)
  assert.equal(store.covers(inner), true)
  assert.equal(store.covers(lookalike), false)
})

test('admin roots cover what is inside them, not what is outside', async () => {
  const { base, file } = await scratch()
  const root = await folder(base, 'labshare')
  const inner = await folder(base, 'labshare/ds')
  const outside = await folder(base, 'elsewhere')
  const store = createTrustStore({ file, adminRoots: [root] })
  assert.equal(store.covers(root), true)
  assert.equal(store.covers(inner), true)
  assert.equal(store.covers(outside), false)
})

test('a path reached through a symlink or with a trailing separator is the same folder', { skip: process.platform === 'win32' && 'symlinks need privileges' }, async () => {
  const { base, file } = await scratch()
  const dir = await folder(base, 'ds')
  await symlink(dir, join(base, 'alias'))
  createTrustStore({ file }).trust(join(base, 'alias'), { scope: 'folder' })
  const store = createTrustStore({ file })
  assert.equal(store.decide(dir, []).trusted, true)
  assert.equal(store.decide(`${dir}/`, []).trusted, true)
})

test('a folder replaced at the same path asks again; one with no usable identity does not', async () => {
  const { base, file } = await scratch()
  const dir = await folder(base, 'ds')
  const store = createTrustStore({ file })
  store.trust(dir, { scope: 'folder' })
  assert.equal(store.decide(dir, []).trusted, true)
  await rm(dir, { recursive: true })
  await sleep(10)
  await mkdir(dir)
  assert.equal(store.decide(dir, []).trusted, false)
  assert.equal(identityOf(join(base, 'missing')), null)
})

test('a version 1 file (path -> accepted findings) is honoured as folder trust and gains an identity', async () => {
  const { base, file } = await scratch()
  const dir = await folder(base, 'ds')
  await writeFile(file, JSON.stringify({ [dir]: ['config a = 1'] }))
  const store = createTrustStore({ file })
  assert.equal(store.decide(dir, ['config a = 1']).trusted, true)
  assert.equal(store.decide(dir, ['config b = 2']).trusted, false)
  const saved = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(saved.version, 2)
  assert.ok(saved.records[dir].identity)
})

test('an old list-of-paths file, a corrupt file and a missing file trust nothing and never throw', async () => {
  const { base, file } = await scratch()
  const dir = await folder(base, 'ds')
  for (const content of [JSON.stringify([dir]), '{ not json', null]) {
    if (content !== null) await writeFile(file, content)
    const store = createTrustStore({ file })
    assert.equal(store.decide(dir, []).trusted, false)
    assert.equal(store.covers(dir), false)
  }
})

test('"not fully scanned" is accepted for this launch only', async () => {
  const { base, file } = await scratch()
  const dir = await folder(base, 'ds')
  const vectors = ['config a = 1', 'not fully scanned (more than 3 repositories)']
  const store = createTrustStore({ file })
  store.trust(dir, { scope: 'folder', vectors })
  assert.equal(store.decide(dir, vectors).trusted, true)
  assert.equal(createTrustStore({ file }).decide(dir, vectors).trusted, false)
  assert.equal(createTrustStore({ file }).decide(dir, ['config a = 1']).trusted, true)
})

test('an unwritable trust file still trusts for this launch', async () => {
  const { base } = await scratch()
  const dir = await folder(base, 'ds')
  const store = createTrustStore({ file: join(base, 'no-such-folder', 'trusted.json') })
  store.trust(dir, { scope: 'tree' })
  assert.equal(store.covers(dir), true)
})
