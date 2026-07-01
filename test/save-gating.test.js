import test from 'node:test'
import assert from 'node:assert/strict'
import { computeSaveGating } from '../src/gui/renderer/save-gating.js'

test('stays enabled without a message, but warns one will be requested', () => {
  const gating = computeSaveGating({ hasMessage: false, hasSelection: false, hasConflicts: false, hasChanges: false })
  assert.equal(gating.disabled, false)
  assert.equal(gating.guidance.text, 'Add a save message, or Save will ask you for one.')
  assert.equal(gating.guidance.warning, true)
})

test('missing message no longer blocks saving selected changes', () => {
  const gating = computeSaveGating({ hasMessage: false, hasSelection: true, hasConflicts: false, hasChanges: true })
  assert.equal(gating.disabled, false)
  assert.match(gating.guidance.text, /ask you for one/)
  assert.equal(gating.guidance.warning, true)
})

test('disabled when conflicts are present, even with a message and selection', () => {
  const gating = computeSaveGating({ hasMessage: true, hasSelection: true, hasConflicts: true, hasChanges: true })
  assert.equal(gating.disabled, true)
  assert.match(gating.guidance.text, /Resolve conflicts/)
  assert.equal(gating.guidance.warning, true)
})

test('disabled when there are changes but nothing selected to save', () => {
  const gating = computeSaveGating({ hasMessage: true, hasSelection: false, hasConflicts: false, hasChanges: true })
  assert.equal(gating.disabled, true)
  assert.match(gating.guidance.text, /Select changed files/)
  assert.equal(gating.guidance.warning, true)
})

test('enabled when there are changes and a selection', () => {
  const gating = computeSaveGating({ hasMessage: true, hasSelection: true, hasConflicts: false, hasChanges: true })
  assert.equal(gating.disabled, false)
  assert.match(gating.guidance.text, /Ready to save/)
  assert.equal(gating.guidance.warning, false)
})

test('enabled with a message even when there are no local changes (manual/empty save)', () => {
  const gating = computeSaveGating({ hasMessage: true, hasSelection: false, hasConflicts: false, hasChanges: false })
  assert.equal(gating.disabled, false)
  assert.match(gating.guidance.text, /No local changes detected/)
  assert.equal(gating.guidance.warning, false)
})

test('conflicts take priority over the missing-selection guidance', () => {
  const gating = computeSaveGating({ hasMessage: true, hasSelection: false, hasConflicts: true, hasChanges: true })
  assert.match(gating.guidance.text, /Resolve conflicts/)
})
