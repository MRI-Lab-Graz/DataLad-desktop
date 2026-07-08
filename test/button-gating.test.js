import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeDatasetGating,
  computeUnlockGating,
  computeRemoteGating,
  computeSyncSectionVisible,
  computeSyncActionsQuietMessage
} from '../src/gui/renderer/button-gating.js'

test('computeDatasetGating disables Get Data when no project is loaded', () => {
  const gating = computeDatasetGating('unknown')
  assert.equal(gating.disabled, true)
  assert.match(gating.title, /not a DataLad dataset/)
})

test('computeDatasetGating disables Get Data for a plain git project', () => {
  const gating = computeDatasetGating('git')
  assert.equal(gating.disabled, true)
  assert.match(gating.title, /not a DataLad dataset/)
})

test('computeDatasetGating enables Get Data for a dataset', () => {
  const gating = computeDatasetGating('dataset')
  assert.equal(gating.disabled, false)
  assert.match(gating.title, /Download the actual content/)
})

test('computeDatasetGating enables Get Data for a superdataset', () => {
  const gating = computeDatasetGating('superdataset')
  assert.equal(gating.disabled, false)
})

test('computeDatasetGating disables Get Data for null/undefined classification', () => {
  assert.equal(computeDatasetGating(null).disabled, true)
  assert.equal(computeDatasetGating(undefined).disabled, true)
})

test('computeDatasetGating disables Get Data for a dataset with nothing left to fetch', () => {
  const gating = computeDatasetGating('dataset', { annexSupported: true, missingContentCount: 0 })
  assert.equal(gating.disabled, true)
  assert.match(gating.title, /nothing to get/)
})

test('computeDatasetGating enables Get Data for a dataset with missing content', () => {
  const gating = computeDatasetGating('dataset', { annexSupported: true, missingContentCount: 3 })
  assert.equal(gating.disabled, false)
})

test('computeDatasetGating enables Get Data for a dataset before health has resolved', () => {
  assert.equal(computeDatasetGating('dataset', null).disabled, false)
  assert.equal(computeDatasetGating('dataset', undefined).disabled, false)
})

test('computeDatasetGating enables Get Data for a dataset when annex support is unknown', () => {
  const gating = computeDatasetGating('dataset', { annexSupported: false, missingContentCount: null })
  assert.equal(gating.disabled, false)
})

test('computeUnlockGating disables Unlock for a plain git project', () => {
  const gating = computeUnlockGating('git')
  assert.equal(gating.disabled, true)
  assert.match(gating.title, /not a DataLad dataset/)
})

test('computeUnlockGating disables Unlock for null/undefined/unknown classification', () => {
  assert.equal(computeUnlockGating(null).disabled, true)
  assert.equal(computeUnlockGating(undefined).disabled, true)
  assert.equal(computeUnlockGating('unknown').disabled, true)
})

test('computeUnlockGating enables Unlock for a dataset', () => {
  const gating = computeUnlockGating('dataset')
  assert.equal(gating.disabled, false)
  assert.match(gating.title, /Use with caution/)
})

test('computeUnlockGating enables Unlock for a superdataset', () => {
  assert.equal(computeUnlockGating('superdataset').disabled, false)
})

test('computeRemoteGating disables Update/Publish when there is no health snapshot', () => {
  const gating = computeRemoteGating(null)
  assert.equal(gating.update.disabled, true)
  assert.equal(gating.publish.disabled, true)
  assert.match(gating.update.title, /No remote is configured/)
  assert.match(gating.publish.title, /No remote is configured/)
  assert.equal(gating.remoteInfo.hidden, true)
  assert.equal(gating.remoteInfo.text, '')
})

test('computeRemoteGating disables Update/Publish when hasUpstream is false', () => {
  const gating = computeRemoteGating({ hasUpstream: false, upstream: null, remoteUrl: null })
  assert.equal(gating.update.disabled, true)
  assert.equal(gating.publish.disabled, true)
  assert.equal(gating.remoteInfo.hidden, true)
})

test('computeRemoteGating enables Update/Publish and shows remote URL when present', () => {
  const gating = computeRemoteGating({
    hasUpstream: true,
    upstream: 'origin/main',
    remoteUrl: 'git@example.org:lab/study.git'
  })

  assert.equal(gating.update.disabled, false)
  assert.equal(gating.publish.disabled, false)
  assert.match(gating.update.title, /origin\/main \(git@example\.org:lab\/study\.git\)/)
  assert.match(gating.publish.title, /origin\/main \(git@example\.org:lab\/study\.git\)/)
  assert.equal(gating.remoteInfo.hidden, false)
  assert.equal(gating.remoteInfo.text, 'Remote: origin/main (git@example.org:lab/study.git)')
})

test('computeRemoteGating falls back to the branch name when the remote URL is unavailable', () => {
  const gating = computeRemoteGating({ hasUpstream: true, upstream: 'origin/main', remoteUrl: null })

  assert.equal(gating.update.disabled, false)
  assert.match(gating.update.title, /from origin\/main\./)
  assert.equal(gating.remoteInfo.text, 'Remote: origin/main')
})

test('computeRemoteGating enables Update/Publish even when ahead/behind counts are unavailable', () => {
  const gating = computeRemoteGating({
    hasUpstream: true,
    upstream: 'origin/main',
    ahead: null,
    behind: null,
    remoteUrl: null
  })

  assert.equal(gating.update.disabled, false)
  assert.equal(gating.publish.disabled, false)
})

test('computeSyncSectionVisible hides the section for a plain git project with no remote', () => {
  assert.equal(computeSyncSectionVisible('git', null), false)
  assert.equal(computeSyncSectionVisible('git', { hasUpstream: false }), false)
})

test('computeSyncSectionVisible hides the section when classification is unknown/null and there is no remote', () => {
  assert.equal(computeSyncSectionVisible('unknown', null), false)
  assert.equal(computeSyncSectionVisible(null, null), false)
  assert.equal(computeSyncSectionVisible(undefined, undefined), false)
})

test('computeSyncSectionVisible shows the section for a dataset even without a remote', () => {
  assert.equal(computeSyncSectionVisible('dataset', null), true)
  assert.equal(computeSyncSectionVisible('superdataset', { hasUpstream: false }), true)
})

test('computeSyncSectionVisible shows the section for a plain git project that has a remote', () => {
  assert.equal(computeSyncSectionVisible('git', { hasUpstream: true }), true)
})

test('computeSyncActionsQuietMessage returns a message when a dataset has no remote and nothing to get', () => {
  const message = computeSyncActionsQuietMessage('dataset', {
    hasUpstream: false,
    annexSupported: true,
    missingContentCount: 0
  })
  assert.match(message, /Nothing to sync right now/)
  assert.match(message, /Get Data once files have missing content/)
})

test('computeSyncActionsQuietMessage returns null once any action is usable', () => {
  assert.equal(
    computeSyncActionsQuietMessage('dataset', {
      hasUpstream: false,
      annexSupported: true,
      missingContentCount: 2
    }),
    null
  )
  assert.equal(
    computeSyncActionsQuietMessage('dataset', {
      hasUpstream: true,
      upstream: 'origin/main',
      annexSupported: true,
      missingContentCount: 0
    }),
    null
  )
})

test('computeSyncActionsQuietMessage returns null before health has resolved (avoids a premature flash)', () => {
  assert.equal(computeSyncActionsQuietMessage('dataset', null), null)
})

test('computeSyncActionsQuietMessage uses git-only wording for a plain git project with a dead remote', () => {
  const message = computeSyncActionsQuietMessage('git', { hasUpstream: false })
  assert.match(message, /Nothing to sync right now/)
  assert.doesNotMatch(message, /Get Data/)
})
