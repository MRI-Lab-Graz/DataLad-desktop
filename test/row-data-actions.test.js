import test from 'node:test'
import assert from 'node:assert/strict'
import { rowDataActions } from '../src/gui/renderer/row-data-actions.js'

const actions = (type, annexPresent) => rowDataActions({ type, annexPresent }).map((a) => a.action)

test('a file that is not downloaded can only be fetched', () => {
  assert.deepEqual(actions('file', false), ['get'])
})

test('a downloaded file can be freed up or unlocked', () => {
  assert.deepEqual(actions('file', true), ['drop', 'unlock'])
})

test('a folder that is not downloaded can be fetched', () => {
  assert.deepEqual(actions('directory', false), ['get'])
})

test('a fully downloaded folder can be freed up', () => {
  assert.deepEqual(actions('directory', true), ['drop'])
})

test('a partly downloaded folder can be fetched or freed up', () => {
  assert.deepEqual(actions('directory', 'partial'), ['get', 'drop'])
})

test('rows that are not annexed (plain Git files, unknown state) get no data actions', () => {
  for (const type of ['file', 'directory']) {
    assert.deepEqual(actions(type, null), [], type)
    assert.deepEqual(actions(type, undefined), [], type)
  }
})

test('every action carries a label and a title', () => {
  for (const a of [...rowDataActions({ type: 'file', annexPresent: true }), ...rowDataActions({ type: 'file', annexPresent: false })]) {
    assert.ok(a.label && a.title, a.action)
  }
  assert.match(rowDataActions({ type: 'file', annexPresent: true }).find((a) => a.action === 'unlock').title, /real, editable copy/)
})
