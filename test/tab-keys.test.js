import test from 'node:test'
import assert from 'node:assert/strict'
import { nextTabIndex } from '../src/gui/renderer/tab-keys.js'

const none = [false, false, false, false]

test('arrow keys move to the next or previous tab and wrap around', () => {
  assert.equal(nextTabIndex(0, 'ArrowDown', none), 1)
  assert.equal(nextTabIndex(0, 'ArrowRight', none), 1)
  assert.equal(nextTabIndex(3, 'ArrowDown', none), 0)
  assert.equal(nextTabIndex(0, 'ArrowUp', none), 3)
  assert.equal(nextTabIndex(2, 'ArrowLeft', none), 1)
})

test('Home and End jump to the first and last tab', () => {
  assert.equal(nextTabIndex(2, 'Home', none), 0)
  assert.equal(nextTabIndex(0, 'End', none), 3)
})

test('hidden tabs are skipped', () => {
  const hidden = [false, true, false, true]
  assert.equal(nextTabIndex(0, 'ArrowDown', hidden), 2)
  assert.equal(nextTabIndex(2, 'ArrowDown', hidden), 0)
  assert.equal(nextTabIndex(0, 'ArrowUp', hidden), 2)
  assert.equal(nextTabIndex(0, 'End', [false, false, true]), 1)
  assert.equal(nextTabIndex(2, 'Home', [true, false, false]), 1)
})

test('other keys are not handled', () => {
  assert.equal(nextTabIndex(0, 'Enter', none), -1)
  assert.equal(nextTabIndex(0, 'a', none), -1)
})
