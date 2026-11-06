import test from 'node:test'
import assert from 'node:assert/strict'
import { runSelectedBatches, planPaths, needsRecklessOffer, isDeleteWord } from '../src/gui/renderer/data-actions.js'

const f = (path, present = false) => ({ path, present, bytes: 1 })
const files = [
  f('sub-01/anat/sub-01_T1w.nii.gz'), f('sub-01/anat/sub-01_T1w.json'),
  f('sub-02/anat/sub-02_T1w.nii.gz'), f('sub-03/anat/sub-03_T1w.nii.gz'),
  f('sub-01/anat/sub-01_old.nii.gz', true)
]
const two = { sub: new Set(['01', '02']) }
const okRun = (calls) => async (name, paths) => (calls.push([name, paths]), { ok: true })

test('get with two subjects runs get only for their paths and companions', async () => {
  const calls = []
  const r = await runSelectedBatches({ mode: 'get', files, selection: two, run: okRun(calls), shouldStop: () => false })
  assert.deepEqual(calls.map((c) => c[0]), ['get'])
  assert.deepEqual(calls[0][1].sort(), ['sub-01/anat/sub-01_T1w.json', 'sub-01/anat/sub-01_T1w.nii.gz', 'sub-02/anat/sub-02_T1w.nii.gz'])
  assert.deepEqual(r, { ok: true, done: 3, failedPaths: [], remainingPaths: [], stopped: false })
})

test('drop mode only ever runs drop, on present files', async () => {
  const calls = []
  await runSelectedBatches({ mode: 'drop', files, selection: two, run: okRun(calls), shouldStop: () => false })
  assert.deepEqual(calls, [['drop', ['sub-01/anat/sub-01_old.nii.gz']]])
})

test('empty selection runs nothing', async () => {
  const calls = []
  const r = await runSelectedBatches({ mode: 'get', files, selection: {}, run: okRun(calls), shouldStop: () => false })
  assert.equal(calls.length, 0)
  assert.deepEqual(r, { ok: true, done: 0, failedPaths: [], remainingPaths: [], stopped: false })
})

const many = Array.from({ length: 30 }, (_, i) => f(`sub-${String(i).padStart(2, '0')}/anat/x${'y'.repeat(200)}_T1w.nii.gz`))
const all = { sub: new Set(many.map((x) => x.path.split('/')[0].slice(4))) }

test('batches run in order and stop at the first failure; the rest is reported, never run', async () => {
  const calls = []
  const run = async (name, paths) => (calls.push(paths), { ok: calls.length < 2 })
  const r = await runSelectedBatches({ mode: 'get', files: many, selection: all, run, shouldStop: () => false })
  assert.equal(calls.length, 2)
  assert.equal(r.ok, false)
  assert.equal(r.stopped, false)
  assert.deepEqual(r.failedPaths, calls[1])
  assert.equal(r.done, calls[0].length)
  assert.equal(r.done + r.failedPaths.length + r.remainingPaths.length, 30)
  assert.equal(needsRecklessOffer(r), true)
})

test('a failed run that returns nothing counts as a failure', async () => {
  const r = await runSelectedBatches({ mode: 'get', files, selection: two, run: async () => null, shouldStop: () => false })
  assert.equal(r.ok, false)
  assert.equal(r.failedPaths.length, 3)
})

test('shouldStop ends the loop and reports stopped', async () => {
  const calls = []
  const run = async (n, p) => (calls.push(p), { ok: false, cancelled: true })
  const r = await runSelectedBatches({ mode: 'get', files: many, selection: all, run, shouldStop: (x) => x.cancelled })
  assert.equal(calls.length, 1)
  assert.equal(r.stopped, true)
  assert.equal(r.ok, false)
  assert.equal(needsRecklessOffer(r), false)
})

test('needsRecklessOffer is false when everything worked', () => {
  assert.equal(needsRecklessOffer({ ok: true, done: 3, failedPaths: [], remainingPaths: [], stopped: false }), false)
})

test('explicit paths replace the plan (used for the failed and remaining files)', async () => {
  const calls = []
  await runSelectedBatches({ mode: 'drop', paths: ['a/b'], run: okRun(calls), shouldStop: () => false })
  assert.deepEqual(calls, [['drop', ['a/b']]])
})

test('onProgress reports each finished batch', async () => {
  const seen = []
  await runSelectedBatches({ mode: 'get', files, selection: two, run: okRun([]), shouldStop: () => false, onProgress: (p) => seen.push(p) })
  assert.deepEqual(seen, [{ batch: 1, batches: 1, done: 3, total: 3 }])
})

test('planPaths lists what would run', () => {
  assert.equal(planPaths(files, two, 'get').length, 3)
})

test('isDeleteWord accepts only the word delete', () => {
  assert.equal(isDeleteWord('delete'), true)
  assert.equal(isDeleteWord(' Delete '), true)
  for (const bad of ['delet', '', 'deleted', 'delete it', null, undefined]) assert.equal(isDeleteWord(bad), false, String(bad))
})
