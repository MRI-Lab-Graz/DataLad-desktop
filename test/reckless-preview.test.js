import test from 'node:test'
import assert from 'node:assert/strict'
import { previewPaths } from '../src/gui/reckless-preview.js'

test('hostile characters never start a new line', () => {
  for (const c of ['\n', '\r', '\u2028', '\u2029', '\u0085', '\u202e', '\u2066', '\u2069', '\u0000', '\u009f']) {
    const out = previewPaths([`a${c}b`])
    assert.equal(out.split(/[\n\r\u2028\u2029\u0085]/).filter(Boolean).length, 1, JSON.stringify(c))
    assert.doesNotMatch(out, /[\u202a-\u202e\u2066-\u2069\u0000-\u0009\u000b-\u001f\u007f-\u009f]/)
  }
})

test('first 5 paths, then "and N more"', () => {
  const p = Array.from({ length: 8 }, (_, i) => `f${i}`)
  const out = previewPaths(p)
  assert.match(out, /f4/)
  assert.doesNotMatch(out, /f5/)
  assert.match(out, /and 3 more/)
  assert.doesNotMatch(previewPaths(p.slice(0, 5)), /more/)
})

test('long paths are cut with an ellipsis', () => {
  const out = previewPaths(['x'.repeat(500)])
  assert.ok(out.length < 220)
  assert.match(out, /…/)
})
