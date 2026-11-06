import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFilterGroups, selectFiles, withCompanions, summarize, batchPaths, toggleValue } from '../src/gui/renderer/data-selection.js'

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

test('groups: all twelve PRISM entities come in the exact required order', () => {
  const ents = ['sub', 'ses', 'task', 'acq', 'run', 'rec', 'dir', 'echo', 'ce', 'part', 'space', 'desc']
  const mk = (v) => {
    const name = ents.map((e) => `${e}-${v}`).join('_') + '_bold.nii.gz'
    return f(`sub-${v}/ses-${v}/func/${name}`)
  }
  const extra = (v) => f(`sub-${v}/ses-${v}/func/sub-${v}_zeta-${v}_alpha-${v}_bold.nii.gz`)
  const g = buildFilterGroups([mk('a'), mk('b'), extra('a'), extra('b'), f('sub-a/ses-a/anat/sub-a_ses-a_T1w.json')])
  assert.deepEqual(keys(g), ['sub', 'ses', 'modality', ...ents.slice(2), 'alpha', 'zeta', 'suffix', 'ext'])
  const title = (k) => g.find((x) => x.key === k)
  assert.equal(title('rec').title, 'Reconstruction')
  assert.equal(title('dir').title, 'Direction')
  assert.equal(title('echo').title, 'Echo')
  assert.equal(title('ce').title, 'Contrast agent')
  assert.equal(title('part').title, 'Part')
  assert.equal(title('space').title, 'Space')
  assert.equal(title('desc').title, 'Description')
  assert.equal(title('rec').hint, 'rec-')
  assert.equal(title('zeta').title, 'zeta')
})

test('prototype-named entity keys do not crash grouping or selection', () => {
  const fs = [
    f('sub-01/func/sub-01_constructor-a_toString-x_bold.nii'),
    f('sub-02/func/sub-02_constructor-b_toString-y_bold.nii'),
    f('sub-02/func/sub-02_bold.nii')
  ]
  const g = buildFilterGroups(fs)
  assert.deepEqual(g.find((x) => x.key === 'constructor').values, ['a', 'b'])
  assert.equal(g.find((x) => x.key === 'toString').title, 'toString')
  const r = selectFiles(fs, { constructor: new Set(['a']) }, 'get')
  assert.deepEqual(r.map((x) => x.path), [fs[0].path])
  assert.deepEqual(selectFiles(fs, { valueOf: new Set(['a']) }, 'get'), [])
  assert.deepEqual(selectFiles(fs, { toString: new Set(['x']) }, 'get').length, 1)
})

test('non-ASCII names group and select', () => {
  const fs = [f('sub-ä01/anat/sub-ä01_T1w.nii.gz'), f('sub-ö02/anat/sub-ö02_T1w.nii.gz')]
  assert.deepEqual(buildFilterGroups(fs).find((x) => x.key === 'sub').values.length, 2)
  assert.equal(selectFiles(fs, { sub: new Set(['ä01']) }, 'get').length, 1)
})

const paths = (r) => r.map((x) => x.path).sort()
const all3 = [
  f('sub-01/func/sub-01_task-rest_bold.nii.gz'),
  f('sub-01/func/sub-01_task-rest_bold.json'),
  f('sub-01/func/sub-01_task-rest_events.tsv'),
  f('sub-01/func/sub-01_task-nback_events.tsv'),
  f('sub-01/func/sub-01_task-rest_bold.json.bak', true),
  f('sub-01/dwi/sub-01_dwi.nii.gz'),
  f('sub-01/dwi/sub-01_dwi.bvec'),
  f('sub-01/dwi/sub-01_dwi.bval'),
  f('participants.tsv'),
  f('participants.json'),
  f('dataset_description.json'),
  f('README'),
  f('CHANGES'),
  f('task-rest_bold.json'),
  f('task-nback_bold.json'),
  f('task-rest_run-1_bold.json')
]

test('bold.nii.gz brings its json and events tsv', () => {
  const r = withCompanions([all3[0]], all3, 'get')
  for (const p of ['sub-01/func/sub-01_task-rest_bold.nii.gz', 'sub-01/func/sub-01_task-rest_bold.json', 'sub-01/func/sub-01_task-rest_events.tsv'])
    assert.ok(paths(r).includes(p), p)
  assert.ok(!paths(r).includes('sub-01/func/sub-01_task-nback_events.tsv'))
  const dwi = withCompanions([all3[5]], all3, 'get')
  assert.ok(paths(dwi).includes('sub-01/dwi/sub-01_dwi.bvec') && paths(dwi).includes('sub-01/dwi/sub-01_dwi.bval'))
})

test('get adds participants.tsv and dataset_description.json, drop does not', () => {
  const get = paths(withCompanions([all3[0]], all3, 'get'))
  for (const p of ['participants.tsv', 'participants.json', 'dataset_description.json', 'README', 'CHANGES']) assert.ok(get.includes(p), p)
  const present = all3.map((x) => ({ ...x, present: true }))
  const drop = paths(withCompanions([present[0]], present, 'drop'))
  assert.ok(!drop.includes('participants.tsv') && !drop.includes('dataset_description.json') && !drop.includes('task-rest_bold.json'))
  assert.ok(drop.includes('sub-01/func/sub-01_task-rest_bold.json'))
})

test('inherited top-level task json is added only when its entities fit', () => {
  const get = paths(withCompanions([all3[0]], all3, 'get'))
  assert.ok(get.includes('task-rest_bold.json'))
  assert.ok(!get.includes('task-nback_bold.json'))
  assert.ok(!get.includes('task-rest_run-1_bold.json'))
})

test('companions follow the presence rule, are deduplicated, and keep the selection', () => {
  const r = withCompanions([all3[0], all3[1]], all3, 'get')
  assert.equal(r.length, new Set(r.map((x) => x.path)).size)
  assert.ok(!paths(r).includes('sub-01/func/sub-01_task-rest_bold.json.bak'))
  const own = withCompanions([{ ...all3[0], present: true }], [{ ...all3[0], present: true }, ...all3.slice(1)], 'get')
  assert.ok(paths(own).includes(all3[0].path))
})

test('summary counts unknown sizes separately', () => {
  assert.deepEqual(summarize([f('a'), { path: 'b', present: false, bytes: null }, { path: 'c', present: false }]), { count: 3, bytes: 10, unknownSize: 2 })
})

test('batches stay under the limit and keep non-ASCII paths intact', () => {
  const ps = Array.from({ length: 50 }, (_, i) => `sub-${i}/Ärzte_日本/file${i}.nii.gz`)
  const b = batchPaths(ps, 200)
  assert.deepEqual(b.flat(), ps)
  assert.ok(b.length > 1)
  for (const batch of b) assert.ok(batch.reduce((n, p) => n + p.length + 1, 0) <= 200)
})

test('an oversized path is a batch of one', () => {
  const big = 'x'.repeat(50)
  assert.deepEqual(batchPaths(['a', big, 'b'], 20), [['a'], [big], ['b']])
  assert.deepEqual(batchPaths([]), [])
})

const sfx = [
  f('sub-01/anat/sub-01_T1w.nii.gz'),
  f('sub-01/anat/sub-01_T1w.json'),
  f('sub-01/anat/sub-01_T2w.nii.gz'),
  f('sub-01/func/sub-01_task-x_bold.nii.gz'),
  f('sub-01/func/sub-01_task-x_bold.json'),
  f('sub-01/func/sub-01_task-x_events.tsv'),
  f('sub-01/func/sub-01_task-x_sbref.nii.gz'),
  f('sub-01/func/sub-01_task-x_physio.tsv.gz'),
  f('task-x_bold.json'),
  f('task-x_sbref.json'),
  f('T1w.json'),
  f('README.md'),
  f('README.exe')
]
test('T1w does not pull T2w; drop neither', () => {
  for (const mode of ['get', 'drop']) {
    const list = sfx.map((x) => ({ ...x, present: mode === 'drop' }))
    const r = paths(withCompanions([list[0]], list, mode))
    assert.ok(!r.includes('sub-01/anat/sub-01_T2w.nii.gz'), mode)
    assert.ok(r.includes('sub-01/anat/sub-01_T1w.json'), mode)
  }
})
test('bold does not pull sbref, physio or top-level sbref json, but keeps json and events', () => {
  const r = paths(withCompanions([sfx[3]], sfx, 'get'))
  for (const p of ['sub-01/func/sub-01_task-x_sbref.nii.gz', 'sub-01/func/sub-01_task-x_physio.tsv.gz', 'task-x_sbref.json']) assert.ok(!r.includes(p), p)
  for (const p of ['sub-01/func/sub-01_task-x_bold.json', 'sub-01/func/sub-01_task-x_events.tsv', 'task-x_bold.json']) assert.ok(r.includes(p), p)
})
test('suffix-less top-level json is not pulled in; README only with doc endings', () => {
  const r = paths(withCompanions([sfx[0]], sfx, 'get'))
  assert.ok(!r.includes('T1w.json') && !r.includes('README.exe') && r.includes('README.md'))
})

test('files without any name-value pair never pair with each other', () => {
  const list = [f('sub-01/anat/data.csv'), f('sub-01/anat/data.json'), f('sub-01/anat/notes.txt')]
  assert.deepEqual(paths(withCompanions([list[0]], list, 'get')), ['sub-01/anat/data.csv'])
  assert.deepEqual(paths(withCompanions([list[2]], list, 'get')), ['sub-01/anat/notes.txt'])
})

test('toggleValue adds and removes a tick without touching other groups, and survives prototype names', () => {
  const sel = { sub: new Set(['sub-01']) }
  const a = toggleValue(sel, 'sub', 'sub-02', true)
  assert.deepEqual([...a.sub], ['sub-01', 'sub-02'])
  assert.deepEqual([...sel.sub], ['sub-01']) // input untouched
  assert.deepEqual([...toggleValue(a, 'sub', 'sub-01', false).sub], ['sub-02'])
  for (const key of ['constructor', 'toString', '__proto__']) {
    const t = toggleValue({}, key, 'x', true)
    assert.deepEqual([...Object.getOwnPropertyDescriptor(t, key).value], ['x'], key)
  }
})
