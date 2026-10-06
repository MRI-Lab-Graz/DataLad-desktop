import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeGitStatusPath,
  mapGitStatusCode,
  mergeGitStatusPriority,
  parseGitStatusPorcelain,
  buildGitStatusMap,
  parseUnmerged,
  parseMergeBranch
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

test('parseUnmerged groups the stages of each conflicted path', () => {
  const out =
    '100644 aaa1 1\tfile.txt\x00100644 aaa2 2\tfile.txt\x00100644 aaa3 3\tfile.txt\x00' +
    '160000 bbb2 2\tsub\x00160000 bbb3 3\tsub\x00' +
    '100644 ccc1 1\t-odd name.txt\x00100644 ccc2 2\t-odd name.txt\x00'
  const map = parseUnmerged(out)
  assert.deepEqual([...map.keys()], ['file.txt', 'sub', '-odd name.txt'])
  assert.equal(map.get('file.txt')['3'].sha, 'aaa3')
  assert.equal(map.get('sub')['2'].mode, '160000')
  assert.equal(map.get('-odd name.txt')['3'], undefined)
  assert.equal(parseUnmerged('').size, 0)
})

test('parseMergeBranch reads the other branch from the merge message', () => {
  assert.equal(parseMergeBranch("Merge branch 'feature/x'\n\n# Conflicts:\n#\ta.txt\n"), 'feature/x')
  assert.equal(parseMergeBranch("Merge remote-tracking branch 'origin/main'\n"), 'origin/main')
  assert.equal(parseMergeBranch('something else'), null)
  assert.equal(parseMergeBranch(''), null)
})
