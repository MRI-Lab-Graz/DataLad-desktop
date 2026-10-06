import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeBannerModel, mergeBlockReason, mergeCandidates } from '../src/gui/renderer/merge-ui.js'

const clean = { stagedCount: 0, unstagedCount: 0, untrackedCount: 2, mergeInProgress: false, files: [] }

test('the picker offers every local branch except the current one', () => {
  assert.deepEqual(mergeCandidates(['feature', 'main', 'x'], 'main'), ['feature', 'x'])
  assert.deepEqual(mergeCandidates([], null), [])
})

test('merging is blocked with a plain reason, first matching rule wins', () => {
  const ok = { branchName: 'feature', currentBranch: 'main', detachedHead: false, snapshot: clean }
  assert.equal(mergeBlockReason(ok), null)
  assert.equal(mergeBlockReason({ ...ok, detachedHead: true }), 'Switch to a branch before merging.')
  assert.equal(mergeBlockReason({ ...ok, currentBranch: null }), 'Switch to a branch before merging.')
  assert.equal(mergeBlockReason({ ...ok, branchName: '' }), 'Pick the branch to merge in first.')
  assert.equal(mergeBlockReason({ ...ok, snapshot: { ...clean, mergeInProgress: true } }), 'Finish or cancel the current merge first.')
  assert.equal(mergeBlockReason({ ...ok, snapshot: { ...clean, stagedCount: 1 } }), 'Save your changes first, then merge.')
  assert.equal(mergeBlockReason({ ...ok, snapshot: { ...clean, unstagedCount: 1 } }), 'Save your changes first, then merge.')
})

test('untracked files alone do not block a merge', () => {
  assert.equal(mergeBlockReason({ branchName: 'f', currentBranch: 'main', detachedHead: false, snapshot: clean }), null)
})

test('there is no banner unless a merge is open', () => {
  assert.deepEqual(mergeBannerModel(clean, 'main'), { visible: false })
  assert.deepEqual(mergeBannerModel(null, 'main'), { visible: false })
})

test('the banner names both branches, counts the files to decide and labels each choice', () => {
  const snapshot = {
    mergeInProgress: true,
    mergeBranch: 'feature',
    files: [
      { path: 'a.txt', conflicted: true, sides: { ours: true, theirs: true } },
      { path: 'gone.txt', conflicted: true, sides: { ours: true, theirs: false } },
      { path: 'fine.txt', conflicted: false }
    ]
  }
  const model = mergeBannerModel(snapshot, 'main')
  assert.equal(model.visible, true)
  assert.equal(model.title, 'Merging feature into main')
  assert.equal(model.summary, '2 files to decide')
  assert.equal(model.canFinish, false)
  assert.deepEqual(model.conflicts[0], { path: 'a.txt', oursLabel: "Keep this branch's version", theirsLabel: "Keep feature's version" })
  assert.equal(model.conflicts[1].theirsLabel, 'Keep it deleted')
  assert.equal(model.conflicts.length, 2)
})

test('with nothing left to decide the merge can be finished', () => {
  const model = mergeBannerModel({ mergeInProgress: true, mergeBranch: null, files: [] }, 'main')
  assert.equal(model.canFinish, true)
  assert.equal(model.summary, 'Everything is decided. Finish the merge to save it.')
  assert.equal(model.title, 'Merging the other branch into main')
})

test('one file reads as singular', () => {
  const model = mergeBannerModel({ mergeInProgress: true, mergeBranch: 'x', files: [{ path: 'a', conflicted: true, sides: { ours: true, theirs: true } }] }, 'main')
  assert.equal(model.summary, '1 file to decide')
})
