import test from 'node:test'
import assert from 'node:assert/strict'
import { computeSaveGating } from '../src/gui/renderer/save-gating.js'

test('stays enabled without a message, but warns one will be requested', () => {
  const gating = computeSaveGating({ hasMessage: false, hasSelection: false, hasConflicts: false, hasChanges: false })
  assert.equal(gating.disabled, false)
  assert.equal(gating.guidance.text, 'Add a checkpoint message, or Save will ask you for one.')
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

test('messageLabel lets callers swap in git terminology for power users', () => {
  const gating = computeSaveGating({
    hasMessage: false,
    hasSelection: false,
    hasConflicts: false,
    hasChanges: false,
    messageLabel: 'commit message'
  })
  assert.equal(gating.guidance.text, 'Add a commit message, or Save will ask you for one.')
})

test('missing git identity shows a warning hint but keeps Save clickable', () => {
  const gating = computeSaveGating({
    hasMessage: true, hasSelection: true, hasConflicts: false, hasChanges: true, hasIdentity: false
  })
  assert.equal(gating.disabled, false)
  assert.equal(gating.guidance.text, 'Set your name and email in Setup before saving.')
  assert.equal(gating.guidance.warning, true)
})

test('hasIdentity defaults to true so existing callers are unchanged', () => {
  const gating = computeSaveGating({ hasMessage: true, hasSelection: true, hasConflicts: false, hasChanges: true })
  assert.equal(gating.guidance.text, 'Ready to save selected changes.')
})

test('PRISM project: selection is not required and the hint says everything is checked and saved together', () => {
  const gating = computeSaveGating({ hasMessage: true, hasSelection: false, hasConflicts: false, hasChanges: true, prismMode: 'gated' })
  assert.equal(gating.disabled, false)
  assert.match(gating.guidance.text, /checked before every save, and everything is saved together/)
  assert.equal(gating.guidance.warning, false)
})

test('the save that adds project.json explains checking starts next time', () => {
  const gating = computeSaveGating({ hasMessage: true, hasSelection: true, hasConflicts: false, hasChanges: true, prismMode: 'conversion' })
  assert.match(gating.guidance.text, /adds project\.json/)
})

test('PRISM mode never hides conflicts', () => {
  const gating = computeSaveGating({ hasMessage: true, hasSelection: true, hasConflicts: true, hasChanges: true, prismMode: 'gated' })
  assert.equal(gating.disabled, true)
  assert.match(gating.guidance.text, /Resolve conflicts/)
})

test('Save is disabled while a merge is open, whatever else is true', () => {
  const gating = computeSaveGating({ hasMessage: true, hasSelection: true, hasConflicts: false, hasChanges: true, mergeInProgress: true })
  assert.equal(gating.disabled, true)
  assert.equal(gating.guidance.text, 'A merge is in progress. Finish or cancel it first.')
  assert.equal(computeSaveGating({ hasMessage: true, hasSelection: true, hasConflicts: false, hasChanges: true }).disabled, false)
})

test('a BIDS project saves everything after a check, with BIDS wording and no selection needed', () => {
  const gating = computeSaveGating({ hasMessage: true, hasSelection: false, hasConflicts: false, hasChanges: true, prismMode: 'bids' })
  assert.equal(gating.disabled, false)
  assert.match(gating.guidance.text, /BIDS project: your data is checked before every save/)
})
