import test from 'node:test'
import assert from 'node:assert/strict'
import { wrapTarget } from '../src/gui/renderer/dialog-focus.js'

const items = ['a', 'b', 'c']

test('Tab on the last element wraps to the first, Shift+Tab on the first wraps to the last', () => {
  assert.equal(wrapTarget(items, 'c', false), 'a')
  assert.equal(wrapTarget(items, 'a', true), 'c')
})

test('Tab in the middle is left to the browser', () => {
  assert.equal(wrapTarget(items, 'a', false), null)
  assert.equal(wrapTarget(items, 'b', true), null)
})

test('focus that is outside the dialog is pulled back in', () => {
  assert.equal(wrapTarget(items, 'page-button', false), 'a')
  assert.equal(wrapTarget(items, 'page-button', true), 'c')
})

test('a dialog with nothing to focus gives no target', () => {
  assert.equal(wrapTarget([], 'x', false), null)
})
