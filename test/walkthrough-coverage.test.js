import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

// Tutorials without a walkthrough yet; each walkthrough task removes its own number.
const NOT_COVERED = ['02', '03', '04', '05', '06']

const nums = (names, suffix) => names.filter((n) => /^\d\d-/.test(n) && n.endsWith(suffix)).map((n) => n.slice(0, 2))

test('every tutorial has a walkthrough or is listed in NOT_COVERED', async () => {
  const tutorials = nums(await readdir(new URL('../docs/tutorials/', import.meta.url)), '.md')
  const covered = nums(await readdir(new URL('../e2e-walkthrough/', import.meta.url)), '.walkthrough.mjs')
  const missing = tutorials.filter((n) => !covered.includes(n) && !NOT_COVERED.includes(n))
  assert.deepEqual(missing, [])
})

test('no NOT_COVERED entry already has a walkthrough (stale entry)', async () => {
  const covered = nums(await readdir(new URL('../e2e-walkthrough/', import.meta.url)), '.walkthrough.mjs')
  assert.deepEqual(NOT_COVERED.filter((n) => covered.includes(n)), [])
})

test('walkthrough script and failure-screenshot ignore rule exist', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts.walkthrough, 'node --test --test-concurrency=1 e2e-walkthrough/*.walkthrough.mjs')
  const ignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8')
  assert.match(ignore, /^walkthrough-failures\/$/m)
})
