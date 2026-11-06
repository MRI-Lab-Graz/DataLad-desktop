import test from 'node:test'
import assert from 'node:assert/strict'
import { vagueMessageNudge } from '../src/gui/renderer/message-suggestion.js'
import { changeSignature, describeSaveValidity } from '../src/gui/renderer/project-card.js'
import { computeSaveGating } from '../src/gui/renderer/save-gating.js'

// --- message nudge: never forbids, only encourages ---

test('a vague message gets a nudge that names what it should say; empty and good messages get none', () => {
  for (const vague of ['update', 'Update', 'updates.', 'changes', 'fix', 'wip', 'test', 'stuff', 'asdf', 'ok', 'x', ' update ']) {
    assert.match(vagueMessageNudge(vague), /what you did/i, vague)
  }
  for (const fine of ['', '   ', 'Fixed sidecar names in sub-01', 'Added resting-state run for sub-03', 'update sub-03']) {
    assert.equal(vagueMessageNudge(fine), '', JSON.stringify(fine))
  }
  assert.doesNotMatch(vagueMessageNudge('update'), /<|>/)
})

// --- change signature: what the files looked like when the check ran ---

test('changeSignature is the same for the same changes in any order, and differs when they differ', () => {
  const a = [{ path: 'a.tsv', status: 'modified' }, { path: 'b.tsv', status: 'untracked' }]
  assert.equal(changeSignature(a), changeSignature([...a].reverse()))
  assert.notEqual(changeSignature(a), changeSignature([a[0]]))
  assert.notEqual(changeSignature(a), changeSignature([{ ...a[0], status: 'deleted' }, a[1]]))
  assert.equal(changeSignature(undefined), '')
  assert.equal(changeSignature([]), '')
})

// --- Save-area validity box ---

const prism = (c) => ({ kind: 'prism', ...c })
const bids = (c) => ({ kind: 'bids', ...c })

test('no check or a plain project: no validity box', () => {
  for (const check of [null, undefined, { kind: null, verdict: 'none' }, {}, 'x']) assert.equal(describeSaveValidity({ check, stale: false }), null)
})

test('fresh results say what they mean in plain words, and only a fresh "not valid" holds Save back', () => {
  assert.deepEqual(describeSaveValidity({ check: prism({ verdict: 'valid' }), stale: false }), { text: '✓ PRISM and BIDS: no problems found.', tone: 'ok', blocksSave: false })
  assert.equal(describeSaveValidity({ check: bids({ verdict: 'valid' }), stale: false }).text, '✓ BIDS: no problems found.')
  const bad = describeSaveValidity({ check: prism({ verdict: 'invalid', errorCount: 2 }), stale: false })
  assert.deepEqual(bad, { text: '✗ 2 problems. Save stays off until they are fixed.', tone: 'bad', blocksSave: true })
  assert.equal(describeSaveValidity({ check: prism({ verdict: 'invalid', errorCount: 1 }), stale: false }).text, '✗ 1 problem. Save stays off until it is fixed.')
  assert.equal(describeSaveValidity({ check: prism({ verdict: 'invalid', errorCount: 0 }), stale: false }).text, '✗ Not valid. Save stays off until it is fixed.')
  assert.equal(describeSaveValidity({ check: prism({ verdict: 'checking' }), stale: false }).blocksSave, false)
})

test('after the files changed, the old result is marked old and no longer holds Save back (Save checks again itself)', () => {
  const valid = describeSaveValidity({ check: prism({ verdict: 'valid' }), stale: true })
  assert.match(valid.text, /files changed since/i)
  assert.match(valid.text, /Check again/)
  assert.equal(valid.blocksSave, false)
  assert.notEqual(valid.tone, 'ok')
  const bad = describeSaveValidity({ check: prism({ verdict: 'invalid', errorCount: 3 }), stale: true })
  assert.match(bad.text, /3 problems/)
  assert.match(bad.text, /files changed since/i)
  assert.equal(bad.blocksSave, false)
})

test('a check that could not run says why and never reads as valid', () => {
  const missing = describeSaveValidity({ check: prism({ verdict: 'unchecked', reason: 'validator-missing' }), stale: false })
  assert.match(missing.text, /Setup/)
  assert.equal(missing.blocksSave, false)
  assert.doesNotMatch(missing.text, /✓/)
  assert.match(describeSaveValidity({ check: prism({ verdict: 'unchecked', reason: 'failed' }), stale: false }).text, /Check again/)
  assert.equal(describeSaveValidity({ check: prism({ verdict: 'VALID' }), stale: false }), null)
  assert.match(describeSaveValidity({ check: prism({ verdict: 'invalid', errorCount: '<b>9</b>' }), stale: false }).text, /^✗ Not valid/)
})

// --- gating: a fresh "not valid" holds Save back, with a plain reason ---

test('computeSaveGating: validity holds Save back with its own guidance, after conflicts and selection', () => {
  const base = { hasMessage: true, hasSelection: true, hasConflicts: false, hasChanges: true, prismMode: 'gated' }
  const held = computeSaveGating({ ...base, validityBlocked: true })
  assert.equal(held.disabled, true)
  assert.match(held.guidance.text, /Fix the problems/)
  assert.equal(computeSaveGating({ ...base, validityBlocked: false }).disabled, false)
  assert.equal(computeSaveGating({ ...base }).disabled, false)
  assert.match(computeSaveGating({ ...base, validityBlocked: true, hasConflicts: true }).guidance.text, /Conflicts/)
})
