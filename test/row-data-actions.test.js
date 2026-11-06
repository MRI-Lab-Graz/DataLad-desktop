import test from 'node:test'
import assert from 'node:assert/strict'
import { rowDataActions } from '../src/gui/renderer/row-data-actions.js'

const actions = (type, annexPresent, hasRemote = true) => rowDataActions({ type, annexPresent }, { hasRemote }).map((a) => a.action)

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
  for (const a of [...rowDataActions({ type: 'file', annexPresent: true }, { hasRemote: true }), ...rowDataActions({ type: 'file', annexPresent: false }, { hasRemote: true })]) {
    assert.ok(a.label && a.title, a.action)
  }
  assert.match(rowDataActions({ type: 'file', annexPresent: true }, { hasRemote: true }).find((a) => a.action === 'unlock').title, /real, editable copy/)
})

test('without a remote there is nowhere else to keep a copy, so Free up space is not offered (Unlock still is)', () => {
  assert.deepEqual(actions('file', true, false), ['unlock'])
  assert.deepEqual(actions('directory', true, false), [])
  assert.deepEqual(actions('directory', 'partial', false), ['get'])
  assert.deepEqual(actions('file', false, false), ['get'], 'a missing file must stay fetchable')
})
