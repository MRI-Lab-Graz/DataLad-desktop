import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeFsck } from '../src/gui/renderer/integrity.js'

const ok = (file) => JSON.stringify({ command: 'fsck', 'error-messages': [], file, success: true })
const bad = (file) => JSON.stringify({ command: 'fsck', 'error-messages': [], file, success: false })

test('summarizeFsck counts checked files and lists damaged ones', () => {
  const stdout = [ok('a.nii'), bad('sub-01/b.nii'), ok('c.tsv'), ''].join('\n')
  assert.deepEqual(summarizeFsck(stdout), { checked: 3, damaged: ['sub-01/b.nii'] })
})

test('summarizeFsck ignores non-JSON noise and empty output', () => {
  assert.deepEqual(summarizeFsck('warning: something\n' + ok('a') + '\nnot json {'), { checked: 1, damaged: [] })
  assert.deepEqual(summarizeFsck(''), { checked: 0, damaged: [] })
})
