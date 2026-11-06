import test from 'node:test'
import assert from 'node:assert/strict'
import { parseBidsPath } from '../src/gui/renderer/bids-path.js'

test('parses a func file', () => {
  const p = parseBidsPath('sub-01/ses-1/func/sub-01_ses-1_task-imagery_acq-Fs2_run-01_bold.nii.gz')
  assert.equal(p.sub, '01')
  assert.equal(p.ses, '1')
  assert.equal(p.modality, 'func')
  assert.deepEqual(p.entities, { sub: '01', ses: '1', task: 'imagery', acq: 'Fs2', run: '01' })
  assert.equal(p.suffix, 'bold')
  assert.equal(p.ext, 'nii.gz')
  assert.equal(p.datasetLevel, false)
})

test('a file without a session has ses null', () => {
  const p = parseBidsPath('sub-01/anat/sub-01_T1w.json')
  assert.equal(p.ses, null)
  assert.equal(p.modality, 'anat')
  assert.equal(p.suffix, 'T1w')
  assert.equal(p.ext, 'json')
})

test('dataset-level files', () => {
  for (const f of ['participants.tsv', 'task-imagery_bold.json']) {
    const p = parseBidsPath(f)
    assert.equal(p.datasetLevel, true)
    assert.equal(p.sub, null)
  }
})

test('non-ASCII and spaces are kept', () => {
  assert.equal(parseBidsPath('sub-Ünï 1/anat/sub-Ünï 1_T1w.nii.gz').sub, 'Ünï 1')
})

test('names that are not BIDS give no entities', () => {
  const p = parseBidsPath('notes/readme.txt')
  assert.deepEqual(p.entities, {})
  assert.equal(p.suffix, null)
  assert.equal(p.modality, null)
})
