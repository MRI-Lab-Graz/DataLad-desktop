import test from 'node:test'
import assert from 'node:assert/strict'
import { computeDatasetGating, computeRemoteGating } from '../src/gui/renderer/button-gating.js'

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
