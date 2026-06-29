import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertCommandRequest,
  assertRunnerResultShape,
  buildCommandResult,
  getAdapterInterfaceContract
} from '../src/datalad/schema.js'

test('assertCommandRequest rejects unsupported command names', () => {
  assert.throws(() => assertCommandRequest('doSomethingElse', {}), /Unsupported command/)
})

test('assertCommandRequest rejects a non-object request', () => {
  assert.throws(() => assertCommandRequest('get', null), /must be an object/)
})

test('assertCommandRequest rejects a missing required field', () => {
  assert.throws(() => assertCommandRequest('save', { projectPath: '/tmp/proj' }), /missing required field message/)
})

test('assertCommandRequest rejects a non-array paths field', () => {
  assert.throws(
    () => assertCommandRequest('get', { projectPath: '/tmp/proj', paths: 'not-an-array' }),
    /paths must be an array/
  )
})

test('assertCommandRequest rejects branch names that start with a dash', () => {
  assert.throws(
    () => assertCommandRequest('createBranch', { projectPath: '/tmp/proj', branchName: '--force' }),
    /cannot start with -/
  )
})

test('assertCommandRequest rejects empty path entries', () => {
  assert.throws(
    () => assertCommandRequest('get', { projectPath: '/tmp/proj', paths: ['ok.txt', '   '] }),
    /each path must be a non-empty string/
  )
})

test('assertCommandRequest accepts a valid request', () => {
  assert.doesNotThrow(() => assertCommandRequest('save', { projectPath: '/tmp/proj', message: 'msg', paths: ['a.txt'] }))
})

test('assertCommandRequest rejects createProject without a targetPath', () => {
  assert.throws(
    () => assertCommandRequest('createProject', {}),
    /missing required field targetPath/
  )
})

test('assertCommandRequest accepts a valid createProject request', () => {
  assert.doesNotThrow(() => assertCommandRequest('createProject', { targetPath: '/tmp/new-proj' }))
})

test('assertRunnerResultShape rejects a result missing a required field', () => {
  assert.throws(
    () => assertRunnerResultShape({ command: 'datalad', args: [], exitCode: 0, stdout: '', stderr: '' }),
    /missing field: failed/
  )
})

test('buildCommandResult marks ok=false when the run failed', () => {
  const result = buildCommandResult(
    'save',
    { command: 'datalad', args: [], exitCode: 1, stdout: '', stderr: 'oops', failed: true },
    { code: 'UNKNOWN' },
    []
  )
  assert.equal(result.ok, false)
  assert.equal(result.commandName, 'save')
})

test('getAdapterInterfaceContract exposes the documented classification values', () => {
  const contract = getAdapterInterfaceContract()
  assert.deepEqual(contract.classificationValues, ['git', 'dataset', 'superdataset'])
})
