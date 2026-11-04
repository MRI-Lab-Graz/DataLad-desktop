import test from 'node:test'
import assert from 'node:assert/strict'
import { stepRunner, requireTools } from '../e2e-walkthrough/harness.mjs'

const fakePage = (fail) => {
  const calls = []
  return { calls, screenshot: async (o) => { calls.push(o); if (fail) throw new Error('shot failed') } }
}

test('failing step screenshots once and rethrows the same error', async () => {
  const page = fakePage()
  const err = new Error('boom')
  const step = stepRunner({ getPage: () => page, outDir: '/out' })
  await assert.rejects(step('Tutorial 00 · step 4: Create Project', async () => { throw err }), (e) => e === err)
  assert.equal(page.calls.length, 1)
  assert.ok(page.calls[0].path.endsWith('tutorial-00-step-4-create-project.png'))
})

test('screenshot failure does not hide the original error', async () => {
  const err = new Error('boom')
  const step = stepRunner({ getPage: () => fakePage(true), outDir: '/out' })
  await assert.rejects(step('x', async () => { throw err }), (e) => e === err)
})

test('undefined page still rethrows', async () => {
  const err = new Error('boom')
  const step = stepRunner({ getPage: () => undefined, outDir: '/out' })
  await assert.rejects(step('x', async () => { throw err }), (e) => e === err)
})

test('passing step takes no screenshot', async () => {
  const page = fakePage()
  await stepRunner({ getPage: () => page, outDir: '/out' })('x', async () => {})
  assert.equal(page.calls.length, 0)
})

test('requireTools names every missing tool', () => {
  assert.throws(() => requireTools(() => false), (e) =>
    /datalad and git-annex must be on PATH/.test(e.message) && ['datalad', 'git-annex', 'git'].every((t) => e.message.includes(t)))
  assert.doesNotThrow(() => requireTools(() => true))
})

test('removeTree deletes a tree with read-only content and ignores a missing folder', async () => {
  const { mkdtemp, mkdir, writeFile, chmod, access } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { removeTree } = await import('../e2e-walkthrough/harness.mjs')
  const dir = await mkdtemp(join(tmpdir(), 'wt-rm-'))
  await mkdir(join(dir, 'objects'))
  await writeFile(join(dir, 'objects', 'blob'), 'x')
  await chmod(join(dir, 'objects', 'blob'), 0o444)
  await chmod(join(dir, 'objects'), 0o555)
  await removeTree(dir)
  await assert.rejects(access(dir))
  await assert.doesNotReject(removeTree(join(dir, 'gone')))
})
