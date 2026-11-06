import test from 'node:test'
import assert from 'node:assert/strict'
import {
  runSelectedBatches, planPaths, needsRecklessOffer, isDeleteWord, panelMatchesProject, describeNotRemoved,
  describeRecklessDialog, planGetAll, describeGetAll, runStillCurrent, canRunReckless, describeActionNote
} from '../src/gui/renderer/data-actions.js'

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
  assert.equal(needsRecklessOffer(r), false) // a plain failure is not a safety refusal
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

const unsafe = { ok: false, userError: { code: 'DROP_UNSAFE' } }
const dropFail = (result) => runSelectedBatches({ mode: 'drop', paths: ['a', 'b'], run: async () => result, shouldStop: (x) => Boolean(x.cancelled) })

test('reckless is offered only for a DROP_UNSAFE refusal', async () => {
  assert.equal(needsRecklessOffer(await dropFail(unsafe)), true)
  const others = [
    { ok: false, userError: { code: 'TRUST_REQUIRED' } },
    { ok: false, userError: { code: 'IDENTITY_MISSING' } },
    { ok: false, userError: { code: 'REPO_LOCKED' } },
    { ok: false, cancelled: true, userError: { code: 'CANCELLED' } },
    { ok: false },
    null
  ]
  for (const r of others) assert.equal(needsRecklessOffer(await dropFail(r)), false, JSON.stringify(r))
})

test('the outcome keeps the failing result', async () => {
  assert.equal((await dropFail(unsafe)).failedResult, unsafe)
})

test('only the refused paths go to the delete-anyway dialog, not the untried rest', async () => {
  const calls = []
  const run = async (n, p) => (calls.push(p), unsafe)
  const r = await runSelectedBatches({ mode: 'drop', paths: many.map((x) => x.path), run, shouldStop: () => false })
  assert.ok(r.remainingPaths.length > 0)
  assert.deepEqual(r.failedPaths, calls[0])
  const msg = describeNotRemoved(r)
  assert.match(msg, /were not removed/)
  assert.match(msg, /not tried/)
  assert.match(msg, /Free up space again/)
})

test('describeNotRemoved says nothing about untried files when none are left', async () => {
  assert.doesNotMatch(describeNotRemoved(await dropFail(unsafe)), /not tried/)
})

test('the dialog text says how many files and how many system confirmations', () => {
  const t = describeRecklessDialog(['a', 'b'])
  assert.match(t, /up to 2 files/i)
  assert.match(t, /1 time/)
  const big = describeRecklessDialog(many.map((x) => x.path))
  assert.match(big, /up to 30 files/i)
  assert.match(big, /\d+ times/)
})

test('panel state belongs to one project', () => {
  assert.equal(panelMatchesProject({ project: '/p' }, '/p'), true)
  assert.equal(panelMatchesProject({ project: '/p' }, '/q'), false)
  assert.equal(panelMatchesProject({ project: null }, null), false)
  assert.equal(panelMatchesProject(null, '/p'), false)
})

test('Get all plans every missing file, no companions needed', () => {
  assert.deepEqual(planGetAll([f('a'), f('b', true), f('c')]), ['a', 'c'])
})

test('Get all confirm text gives the count and size, or says it is unknown', () => {
  assert.match(describeGetAll([f('a'), f('b')]), /2 files.*2 B/)
  assert.match(describeGetAll([{ path: 'a', present: false, bytes: null }]), /size is not known/)
  assert.match(describeGetAll(null), /not known/)
  assert.match(describeGetAll([f('a', true)]), /No files/)
})

test('a run only writes panel state while its project is still the open one', () => {
  assert.equal(runStillCurrent({ panelProject: '/A', rootProject: '/A', runProject: '/A' }), true)
  // A -> B switch during the run: the panel already belongs to B
  assert.equal(runStillCurrent({ panelProject: '/B', rootProject: '/B', runProject: '/A' }), false)
  assert.equal(runStillCurrent({ panelProject: '/A', rootProject: '/B', runProject: '/A' }), false)
  assert.equal(runStillCurrent({ panelProject: null, rootProject: null, runProject: null }), false)
})

test('delete-anyway runs only in the project where the refusal happened', () => {
  assert.equal(canRunReckless({ unsafeProject: '/A', panelProject: '/A', rootProject: '/A' }), true)
  assert.equal(canRunReckless({ unsafeProject: '/A', panelProject: '/B', rootProject: '/B' }), false)
  assert.equal(canRunReckless({ unsafeProject: '/A', panelProject: '/A', rootProject: '/B' }), false)
  assert.equal(canRunReckless({ unsafeProject: null, panelProject: null, rootProject: null }), false)
})

test('describeActionNote: the note after an action, kept for the reload that follows', () => {
  const ok = { ok: true, stopped: false, failedPaths: [], remainingPaths: [] }
  assert.equal(describeActionNote('get', ok), '')
  assert.equal(describeActionNote('drop', ok), '')
  assert.equal(describeActionNote('drop', { ...ok, ok: false, stopped: true }), 'Stopped. The rest was not touched.')
  const bad = { ok: false, stopped: false, failedPaths: ['a'], remainingPaths: ['b', 'c'] }
  assert.match(describeActionNote('get', bad), /3 files were not downloaded/)
  assert.match(describeActionNote('get', { ...bad, remainingPaths: [] }), /1 file was not downloaded/)
  assert.match(describeActionNote('drop', bad), /not tried; press Free up space again/)
  assert.match(describeActionNote('reckless', bad), /3 files were not removed/)
  assert.equal(describeActionNote('reckless', ok), '')
})

test('Get all and empty-list wording never claims everything is downloaded', () => {
  const t = describeGetAll([f('a', true)])
  assert.match(t, /No files that still need downloading were found in the list/)
  assert.doesNotMatch(t, /Nothing is missing|already on this computer/)
})
