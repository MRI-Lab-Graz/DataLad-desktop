import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeSaveStatusChip,
  computeSyncStatusChip,
  computeMissingContentChip,
  computeStatusLine
} from '../src/gui/renderer/project-health-chips.js'

test('save status chip: unknown when there is no working tree snapshot yet', () => {
  assert.deepEqual(computeSaveStatusChip(null), { tone: 'neutral', label: 'Save status unknown' })
})

test('save status chip: good when clean', () => {
  assert.deepEqual(computeSaveStatusChip({ clean: true, totalChanged: 0 }), { tone: 'good', label: 'Saved' })
})

test('save status chip: urgent with a count when dirty', () => {
  assert.deepEqual(
    computeSaveStatusChip({ clean: false, totalChanged: 3 }),
    { tone: 'urgent', label: 'Unsaved changes 3' }
  )
})

test('sync status chip: neutral "no remote" when there is no upstream', () => {
  assert.deepEqual(computeSyncStatusChip(null), { tone: 'neutral', label: 'No remote tracked' })
  assert.deepEqual(computeSyncStatusChip({ hasUpstream: false }), { tone: 'neutral', label: 'No remote tracked' })
})

test('sync status chip: neutral "tracking" when ahead/behind are unknown', () => {
  assert.deepEqual(
    computeSyncStatusChip({ hasUpstream: true, upstream: 'origin/main', ahead: null, behind: null }),
    { tone: 'neutral', label: 'Tracking origin/main' }
  )
})

test('sync status chip: good "in sync" when ahead and behind are both zero', () => {
  assert.deepEqual(
    computeSyncStatusChip({ hasUpstream: true, upstream: 'origin/main', ahead: 0, behind: 0 }),
    { tone: 'good', label: 'In sync with origin/main' }
  )
})

test('sync status chip: warning with counts when ahead and/or behind', () => {
  assert.deepEqual(
    computeSyncStatusChip({ hasUpstream: true, upstream: 'origin/main', ahead: 2, behind: 0 }),
    { tone: 'warning', label: '2 to publish' }
  )
  assert.deepEqual(
    computeSyncStatusChip({ hasUpstream: true, upstream: 'origin/main', ahead: 0, behind: 5 }),
    { tone: 'warning', label: '5 to update' }
  )
  assert.deepEqual(
    computeSyncStatusChip({ hasUpstream: true, upstream: 'origin/main', ahead: 1, behind: 2 }),
    { tone: 'warning', label: '1 to publish, 2 to update' }
  )
})

test('missing content chip: hidden entirely when git-annex is unsupported', () => {
  assert.equal(computeMissingContentChip(null), null)
  assert.equal(computeMissingContentChip({ annexSupported: false }), null)
})

test('missing content chip: good when all data is present', () => {
  assert.deepEqual(
    computeMissingContentChip({ annexSupported: true, missingContentCount: 0 }),
    { tone: 'good', label: 'All data present' }
  )
})

test('missing content chip: warning with count when content is missing', () => {
  assert.deepEqual(
    computeMissingContentChip({ annexSupported: true, missingContentCount: 4 }),
    { tone: 'warning', label: 'Data not downloaded: 4' }
  )
})

test('status line: neutral when tree or health has not resolved yet', () => {
  assert.deepEqual(computeStatusLine(null, { hasUpstream: false }), { tone: 'neutral', label: 'Status unknown.' })
  assert.deepEqual(computeStatusLine({ clean: true, totalChanged: 0 }, null), {
    tone: 'neutral',
    label: 'Status unknown.'
  })
})

test('status line: urgent for unsaved changes, singular vs plural', () => {
  assert.deepEqual(computeStatusLine({ clean: false, totalChanged: 1 }, { hasUpstream: false }), {
    tone: 'urgent',
    label: '⚠️ 1 unsaved change — save a checkpoint when ready.'
  })
  assert.deepEqual(computeStatusLine({ clean: false, totalChanged: 3 }, { hasUpstream: false }), {
    tone: 'urgent',
    label: '⚠️ 3 unsaved changes — save a checkpoint when ready.'
  })
})

test('status line: warning when saved but content is missing', () => {
  assert.deepEqual(
    computeStatusLine(
      { clean: true, totalChanged: 0 },
      { hasUpstream: false, annexSupported: true, missingContentCount: 2 }
    ),
    { tone: 'warning', label: '⚠️ Saved, but some file content has not been downloaded yet.' }
  )
})

test('status line: warning when saved and data present but out of sync with remote', () => {
  assert.deepEqual(
    computeStatusLine(
      { clean: true, totalChanged: 0 },
      { hasUpstream: true, upstream: 'origin/main', ahead: 2, behind: 0, annexSupported: false }
    ),
    { tone: 'warning', label: '⚠️ Saved, but out of sync with remote (2 to publish).' }
  )
})

test('status line: good when clean, in sync, and all data present', () => {
  assert.deepEqual(
    computeStatusLine(
      { clean: true, totalChanged: 0 },
      { hasUpstream: true, upstream: 'origin/main', ahead: 0, behind: 0, annexSupported: true, missingContentCount: 0 }
    ),
    { tone: 'good', label: '✅ Everything is saved and up to date.' }
  )
})

test('status line: good when clean and there is no remote/annex to worry about', () => {
  assert.deepEqual(computeStatusLine({ clean: true, totalChanged: 0 }, { hasUpstream: false }), {
    tone: 'good',
    label: '✅ Everything is saved and up to date.'
  })
})
