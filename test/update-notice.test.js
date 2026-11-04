import test from 'node:test'
import assert from 'node:assert/strict'
import { describeUpdates } from '../src/gui/renderer/update-notice.js'

const notice = { tool: 'datalad', installed: '1.7.0', latest: '99.0.0', message: 'DataLad 99.0.0 is available.' }

test('disabled or missing status gives no lines', () => {
  assert.deepEqual(describeUpdates({ disabled: true, validator: { status: 'updated', from: '1', to: '2' }, notices: [notice] }), { lines: [] })
  assert.deepEqual(describeUpdates(null), { lines: [] })
  assert.deepEqual(describeUpdates({ disabled: false, validator: null, notices: [] }), { lines: [] })
})

test('updated validator names both versions', () => {
  const { lines } = describeUpdates({ disabled: false, validator: { status: 'updated', from: '1.0.0', to: '1.1.0' }, notices: [] })
  assert.deepEqual(lines, [{ text: 'prism-validator was updated from 1.0.0 to 1.1.0.' }])
})

test('failed validator update reassures', () => {
  const { lines } = describeUpdates({ disabled: false, validator: { status: 'failed', reason: 'x' }, notices: [] })
  assert.deepEqual(lines, [{ text: 'prism-validator has a newer version that could not be installed. The current one keeps working.' }])
})

test('notices carry a skip target', () => {
  const { lines } = describeUpdates({ disabled: false, validator: null, notices: [notice] })
  assert.deepEqual(lines, [{ text: notice.message, skip: { tool: 'datalad', version: '99.0.0' } }])
})

test('current, offline and deferred validator states say nothing', () => {
  for (const status of ['current', 'offline', 'deferred']) {
    assert.deepEqual(describeUpdates({ disabled: false, validator: { status }, notices: [] }), { lines: [] })
  }
})
