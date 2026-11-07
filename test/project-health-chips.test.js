import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeSaveStatusChip,
  computeSyncStatusChip,
  computeMissingContentChip,
  computeStatusLine,
  computeAttentionRows
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
    { tone: 'warning', label: '2 not sent yet' }
  )
  assert.deepEqual(
    computeSyncStatusChip({ hasUpstream: true, upstream: 'origin/main', ahead: 0, behind: 5 }),
    { tone: 'warning', label: '5 to get' }
  )
  assert.deepEqual(
    computeSyncStatusChip({ hasUpstream: true, upstream: 'origin/main', ahead: 1, behind: 2 }),
    { tone: 'warning', label: '1 not sent yet, 2 to get' }
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
    label: '⚠️ 1 unsaved change — save when ready.'
  })
  assert.deepEqual(computeStatusLine({ clean: false, totalChanged: 3 }, { hasUpstream: false }), {
    tone: 'urgent',
    label: '⚠️ 3 unsaved changes — save when ready.'
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
    { tone: 'warning', label: '⚠️ Saved, but out of sync with remote (2 not sent yet).' }
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

test('attention rows: none when health is unknown or everything is fine', () => {
  assert.deepEqual(computeAttentionRows(null), [])
  assert.deepEqual(computeAttentionRows(undefined), [])
  assert.deepEqual(
    computeAttentionRows({ annexSupported: true, missingContentCount: 0, hasUpstream: true, upstream: 'origin/main', ahead: 0, behind: 0 }),
    []
  )
})

test('attention rows: missing data row, singular and plural', () => {
  assert.deepEqual(computeAttentionRows({ annexSupported: true, missingContentCount: 12 }), [
    { kind: 'missing', count: 12, label: '12 files not downloaded', action: 'Get all' }
  ])
  assert.equal(computeAttentionRows({ annexSupported: true, missingContentCount: 1 })[0].label, '1 file not downloaded')
})

test('attention rows: ignores a missing count when annex is not supported', () => {
  assert.deepEqual(computeAttentionRows({ annexSupported: false, missingContentCount: 5 }), [])
})

test('attention rows: publish and update rows from ahead/behind, in a fixed order', () => {
  const rows = computeAttentionRows({
    annexSupported: true, missingContentCount: 2, hasUpstream: true, upstream: 'origin/main', ahead: 2, behind: 1
  })
  assert.deepEqual(rows.map((row) => row.kind), ['missing', 'publish', 'update'])
  assert.equal(rows[1].label, '2 saves not sent yet')
  assert.equal(rows[1].action, 'Send my saves')
  assert.equal(rows[2].label, '1 update available')
  assert.equal(rows[2].action, 'Get updates')
})

test('attention rows: no sync rows without an upstream or with unknown ahead/behind', () => {
  assert.deepEqual(computeAttentionRows({ hasUpstream: false, ahead: 3, behind: 3 }), [])
  assert.deepEqual(computeAttentionRows({ hasUpstream: true, upstream: 'origin/main', ahead: null, behind: undefined }), [])
})

// Does the place the project came from accept changes? (null = not asked yet)
const clean = { clean: true, totalChanged: 0 }
const ahead = (extra) => ({ hasUpstream: true, upstream: 'origin/main', ahead: 103, behind: 0, annexSupported: false, ...extra })

test('source answer yes, or nothing to publish, or no upstream: exactly the old status line and Publish row', () => {
  for (const sourceAccepts of ['yes', undefined]) {
    assert.deepEqual(computeStatusLine(clean, ahead({ sourceAccepts })), { tone: 'warning', label: '⚠️ Saved, but out of sync with remote (103 not sent yet).' })
    assert.deepEqual(computeAttentionRows(ahead({ sourceAccepts })), [{ kind: 'publish', count: 103, label: '103 saves not sent yet', action: 'Send my saves' }])
  }
  for (const sourceAccepts of [null, 'no']) {
    assert.equal(computeStatusLine(clean, ahead({ ahead: 0, sourceAccepts })).tone, 'good')
    assert.deepEqual(computeAttentionRows(ahead({ ahead: 0, sourceAccepts })), [])
    const none = { hasUpstream: false, ahead: null, sourceAccepts }
    assert.equal(computeStatusLine(clean, none).tone, 'good')
    assert.deepEqual(computeAttentionRows(none), [])
  }
})

test('source answer unknown with unpublished saves: a neutral line and a question with three answers', () => {
  const health = ahead({ sourceAccepts: null })
  assert.deepEqual(computeStatusLine(clean, health), { tone: 'neutral', label: '103 saves are only on this computer.' })
  assert.deepEqual(computeAttentionRows(health), [{
    kind: 'question',
    count: 103,
    label: 'These 103 saves are only on this computer. Can you send changes back to the place this project came from?',
    groupLabel: 'Can you send changes back?',
    answers: [
      { answer: 'yes', text: 'Yes' },
      { answer: 'no', text: 'No, it is read-only' },
      { answer: 'unsure', text: 'Not sure' }
    ]
  }])
})

test('source answer unknown, one save: singular wording', () => {
  const health = ahead({ ahead: 1, sourceAccepts: null })
  assert.equal(computeStatusLine(clean, health).label, '1 save is only on this computer.')
  assert.match(computeAttentionRows(health)[0].label, /^This 1 save is only on this computer\./)
})

test('source answer no with unpublished saves: calm line, and Add a Remote instead of Publish', () => {
  const health = ahead({ sourceAccepts: 'no' })
  assert.deepEqual(computeStatusLine(clean, health), { tone: 'neutral', label: '103 saves only on this computer. The place this project came from does not accept changes.' })
  assert.deepEqual(computeAttentionRows(health), [{
    kind: 'readonly',
    count: 103,
    label: 'To share these saves, add your own remote (a USB drive, a network share or your own repository).',
    action: 'Add a Remote',
    undo: 'My answer was wrong'
  }])
  assert.equal(computeStatusLine(clean, ahead({ ahead: 1, sourceAccepts: 'no' })).label, '1 save only on this computer. The place this project came from does not accept changes.')
})

test('unsaved changes still come first in the status line', () => {
  assert.equal(computeStatusLine({ clean: false, totalChanged: 2 }, ahead({ sourceAccepts: null })).tone, 'urgent')
})
