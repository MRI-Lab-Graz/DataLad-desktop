import test from 'node:test'
import assert from 'node:assert/strict'
import { createLatestWins } from '../src/gui/renderer/latest-wins.js'

// Regression for issue #3: Save awaited a status refresh that a file-watcher
// refresh superseded, so it got the stale result back before the newest
// refresh had synced the selection.
test('a superseded call resolves to the newest call\'s result, not its own', async () => {
  const run = createLatestWins()
  let releaseFirst
  const first = run(() => new Promise((resolve) => { releaseFirst = () => resolve('stale') }))
  const second = run(() => Promise.resolve('fresh'))

  releaseFirst()
  assert.equal(await first, 'fresh')
  assert.equal(await second, 'fresh')
})

test('a lone call resolves to its own result', async () => {
  const run = createLatestWins()
  assert.equal(await run(() => Promise.resolve('only')), 'only')
})

test('a chain of supersessions resolves to the last call', async () => {
  const run = createLatestWins()
  const a = run(() => Promise.resolve('a'))
  const b = run(() => Promise.resolve('b'))
  const c = run(() => Promise.resolve('c'))
  assert.deepEqual(await Promise.all([a, b, c]), ['c', 'c', 'c'])
})
