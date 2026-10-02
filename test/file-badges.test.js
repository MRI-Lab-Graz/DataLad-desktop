import test from 'node:test'
import assert from 'node:assert/strict'
import { renderAnnexBadge } from '../src/gui/renderer/file-badges.js'

test('no badge when the content is here (the normal case) or unknown', () => {
  assert.equal(renderAnnexBadge(true), '')
  assert.equal(renderAnnexBadge(null), '')
  assert.equal(renderAnnexBadge(undefined), '')
})

test('files whose content is not on this computer are flagged', () => {
  assert.match(renderAnnexBadge(false), /Not downloaded/)
})

test('folders with only some of their content here are flagged as partial', () => {
  assert.match(renderAnnexBadge('partial'), /Partial/)
})
