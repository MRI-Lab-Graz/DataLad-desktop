import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeGitStatusPath,
  mapGitStatusCode,
  mergeGitStatusPriority,
  parseGitStatusPorcelain,
  buildGitStatusMap
} from '../src/datalad/status.js'

test('normalizeGitStatusPath resolves renamed/copied paths to their destination', () => {
  assert.equal(normalizeGitStatusPath('old.txt -> new.txt', 'R '), 'new.txt')
  assert.equal(normalizeGitStatusPath('old.txt -> new.txt', 'C '), 'new.txt')
})

test('normalizeGitStatusPath leaves non-rename paths untouched besides separator cleanup', () => {
  assert.equal(normalizeGitStatusPath('.\\sub\\dir\\file.txt', 'M '), 'sub/dir/file.txt')
})

test('mapGitStatusCode maps every known git status letter', () => {
  assert.equal(mapGitStatusCode('??'), 'untracked')
  assert.equal(mapGitStatusCode('UU'), 'conflict')
  assert.equal(mapGitStatusCode(' D'), 'deleted')
  assert.equal(mapGitStatusCode('R '), 'renamed')
  assert.equal(mapGitStatusCode('A '), 'added')
  assert.equal(mapGitStatusCode(' M'), 'modified')
  assert.equal(mapGitStatusCode('!!'), 'changed')
})

test('mergeGitStatusPriority keeps the higher-priority status and handles an empty left side', () => {
  assert.equal(mergeGitStatusPriority(undefined, 'modified'), 'modified')
  assert.equal(mergeGitStatusPriority('modified', 'conflict'), 'conflict')
  assert.equal(mergeGitStatusPriority('conflict', 'modified'), 'conflict')
})

test('parseGitStatusPorcelain skips blank and too-short lines', () => {
  const result = parseGitStatusPorcelain('\n  \nM  a.txt\n')
  assert.equal(result.totalChanged, 1)
  assert.equal(result.files[0].path, 'a.txt')
})

test('parseGitStatusPorcelain returns a clean result for empty output', () => {
  const result = parseGitStatusPorcelain('')
  assert.equal(result.clean, true)
  assert.equal(result.totalChanged, 0)
})

test('buildGitStatusMap exposes a path-to-status lookup', () => {
  const map = buildGitStatusMap('M  a.txt\n?? b.txt\n')
  assert.equal(map.get('a.txt'), 'modified')
  assert.equal(map.get('b.txt'), 'untracked')
})
