import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldIgnorePath, getIgnoredDirectoryNames } from '../src/gui/watch-ignore.js'

test('ignores paths under .git, including nested annex internals', () => {
  assert.equal(shouldIgnorePath('.git/index'), true)
  assert.equal(shouldIgnorePath('.git/annex/objects/foo'), true)
})

test('ignores paths under .datalad, .github, and node_modules', () => {
  assert.equal(shouldIgnorePath('.datalad/config'), true)
  assert.equal(shouldIgnorePath('.github/workflows/ci.yml'), true)
  assert.equal(shouldIgnorePath('node_modules/foo/index.js'), true)
})

test('ignores nested occurrences, not just top-level', () => {
  assert.equal(shouldIgnorePath('sub/project/.git/HEAD'), true)
})

test('ignores common OS noise files', () => {
  assert.equal(shouldIgnorePath('.DS_Store'), true)
  assert.equal(shouldIgnorePath('data/Thumbs.db'), true)
  assert.equal(shouldIgnorePath('desktop.ini'), true)
  assert.equal(shouldIgnorePath('~$notes.docx'), true)
  assert.equal(shouldIgnorePath('data/scratch.tmp'), true)
  assert.equal(shouldIgnorePath('src/app.js.swp'), true)
})

test('does not ignore normal researcher data files', () => {
  assert.equal(shouldIgnorePath('data/results.csv'), false)
  assert.equal(shouldIgnorePath('scripts/analysis.py'), false)
  assert.equal(shouldIgnorePath('README.md'), false)
})

test('handles empty/undefined input safely', () => {
  assert.equal(shouldIgnorePath(''), false)
  assert.equal(shouldIgnorePath(undefined), false)
})

test('exposes the ignored directory name list for reuse', () => {
  const names = getIgnoredDirectoryNames()
  assert.ok(names.includes('.git'))
  assert.ok(names.includes('.datalad'))
  assert.ok(names.includes('node_modules'))
})
