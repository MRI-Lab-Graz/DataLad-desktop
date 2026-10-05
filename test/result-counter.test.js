import test from 'node:test'
import assert from 'node:assert/strict'
import { createResultCounter } from '../src/datalad/result-counter.js'

test('counts per-file get and copy results, not dataset or summary lines', () => {
  const counter = createResultCounter()
  const n = counter.push(
    'get(ok): a.nii (file) [from origin...]\n' +
      'get(notneeded): b.nii (file) [already present]\n' +
      'install(ok): sub-01 (dataset)\n' +
      'copy(ok): c.nii (file) [to backup...]\n' +
      'action summary:\n  get (ok: 1)\n'
  )
  assert.equal(n, 3)
})

test('a line split across chunks is counted once, after it completes', () => {
  const counter = createResultCounter()
  assert.equal(counter.push('get(ok): a.n'), 0)
  assert.equal(counter.push('ii (file) [from origin...]\r\nget(ok): b'), 1)
  assert.equal(counter.push('.nii (file)\n'), 2)
})
