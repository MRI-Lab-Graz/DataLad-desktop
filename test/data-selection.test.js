import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFilterGroups, selectFiles } from '../src/gui/renderer/data-selection.js'

const f = (path, present = false) => ({ path, present, bytes: 10 })
const files = [
  f('sub-01/ses-1/anat/sub-01_ses-1_T1w.nii.gz'),
  f('sub-01/ses-1/anat/sub-01_ses-1_T1w.json', true),
  f('sub-01/ses-1/func/sub-01_ses-1_task-rest_run-1_bold.nii.gz'),
  f('sub-01/ses-1/func/sub-01_ses-1_task-rest_run-2_bold.nii.gz', true),
  f('sub-01/ses-1/func/sub-01_ses-1_task-nback_run-1_bold.nii.gz'),
  f('sub-02/ses-1/anat/sub-02_ses-1_T1w.nii.gz'),
  f('sub-02/ses-1/func/sub-02_ses-1_task-rest_run-1_bold.nii.gz'),
  f('sub-02/ses-1/func/sub-02_ses-1_task-nback_run-1_bold.nii.gz'),
  f('sub-02/ses-1/func/sub-02_ses-1_task-nback_run-10_bold.nii.gz'),
  f('sub-02/ses-1/func/sub-02_ses-1_task-nback_run-2_bold.nii.gz'),
  f('sub-02/sub-02_scans.tsv'),
  f('sub-02/ses-1/func/sub-02_ses-1_task-nback_acq-hi_bold.json')
]
const keys = (g) => g.map((x) => x.key)

test('groups: one-value entities are hidden', () => {
  assert.ok(!keys(buildFilterGroups(files)).includes('ses'))
})

test('groups: order is sub, ses, modality, task, acq, run, suffix, ext', () => {
  const withSes = [...files, f('sub-02/ses-2/anat/sub-02_ses-2_T1w.nii.gz')]
  assert.deepEqual(keys(buildFilterGroups(withSes)), ['sub', 'ses', 'modality', 'task', 'run', 'suffix', 'ext'])
  const g = buildFilterGroups([...withSes, f('sub-01/ses-1/func/sub-01_ses-1_task-rest_acq-lo_bold.json'), f('sub-01/ses-1/func/sub-01_ses-1_task-rest_acq-hi_bold.json')])
  assert.deepEqual(keys(g).slice(3, 6), ['task', 'acq', 'run'])
})

test('groups: values sorted naturally, titles and hints set', () => {
  const run = buildFilterGroups(files).find((g) => g.key === 'run')
  assert.deepEqual(run.values, ['1', '2', '10'])
  assert.equal(run.title, 'Run')
  const task = buildFilterGroups(files).find((g) => g.key === 'task')
  assert.equal(task.title, 'Task')
  assert.equal(task.hint, 'task-')
})

test('nothing ticked selects nothing', () => {
  assert.deepEqual(selectFiles(files, {}, 'get'), [])
  assert.deepEqual(selectFiles(files, { sub: new Set() }, 'get'), [])
})

test('ticking Subjects and Modalities intersects', () => {
  const r = selectFiles(files, { sub: new Set(['02']), modality: new Set(['anat']) }, 'get')
  assert.deepEqual(r.map((x) => x.path), ['sub-02/ses-1/anat/sub-02_ses-1_T1w.nii.gz'])
})

test('a file without ses- does not match a ses filter', () => {
  const r = selectFiles(files, { sub: new Set(['02']), ses: new Set(['1']) }, 'get')
  assert.ok(!r.some((x) => x.path === 'sub-02/sub-02_scans.tsv'))
  assert.ok(r.length > 0)
})

test('get skips files already present; drop skips files not present', () => {
  const sel = { sub: new Set(['01']) }
  assert.ok(selectFiles(files, sel, 'get').every((x) => !x.present))
  assert.ok(selectFiles(files, sel, 'drop').every((x) => x.present))
  assert.equal(selectFiles(files, sel, 'drop').length, 2)
})

test('values inside a group are OR', () => {
  const r = selectFiles(files, { sub: new Set(['01', '02']), modality: new Set(['anat']) }, 'get')
  assert.equal(r.length, 2)
})

test('50000 files build groups in under 1000 ms', () => {
  const many = Array.from({ length: 50000 }, (_, i) => f(`sub-${i % 500}/ses-${i % 3}/func/sub-${i % 500}_ses-${i % 3}_task-t${i % 5}_run-${i % 7}_bold.nii.gz`))
  const t = performance.now()
  buildFilterGroups(many)
  assert.ok(performance.now() - t < 1000)
})
