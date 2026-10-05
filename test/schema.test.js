import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertCommandRequest,
  assertRunnerResultShape,
  buildCommandResult
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

test('assertCommandRequest rejects a clone source that looks like an option or ext:: transport', () => {
  const base = { targetPath: '/tmp/ds' }
  assert.throws(() => assertCommandRequest('cloneInstall', { ...base, source: '--upload-pack=touch x' }), /source cannot start with -/)
  assert.throws(() => assertCommandRequest('cloneInstall', { ...base, source: 'ext::sh -c touch% x' }), /transport is not allowed/)
  assert.doesNotThrow(() => assertCommandRequest('cloneInstall', { ...base, source: 'https://example.org/ds.git' }))
})

// Node's spawn turns an array argument into a string, and the main-process checks compare strings:
// a field that is not a string must never get that far.
test('every text field rejects values that are not strings', () => {
  const valid = {
    cloneInstall: { source: 'https://example.org/ds', targetPath: '/p' },
    createProject: { targetPath: '/p', procedure: 'text2git' },
    createSubdataset: { projectPath: '/p', relativePath: 'sub-01', procedure: 'text2git' },
    save: { projectPath: '/p', message: 'm' },
    createBranch: { projectPath: '/p', branchName: 'b' },
    createBranchAt: { projectPath: '/p', branchName: 'b', startPoint: 'abcd' },
    disconnectRemote: { projectPath: '/p', remoteName: 'origin' },
    get: { projectPath: '/p' }
  }
  for (const [commandName, request] of Object.entries(valid)) {
    assertCommandRequest(commandName, request)
    for (const field of Object.keys(request)) {
      for (const bad of [['x'], { a: 1 }, 7, true]) {
        assert.throws(() => assertCommandRequest(commandName, { ...request, [field]: bad }), /must be a string/, `${commandName}.${field}=${JSON.stringify(bad)}`)
      }
    }
  }
})

test('force must be a boolean', () => {
  assertCommandRequest('createProject', { targetPath: '/p', force: true })
  assert.throws(() => assertCommandRequest('createProject', { targetPath: '/p', force: 'yes' }), /force must be a boolean/)
})

test('addRemote refuses flag-like values and the ext:: transport', () => {
  assert.throws(() => assertCommandRequest('addRemote', { projectPath: '/p', remoteName: '-x', url: 'https://a' }), /cannot start with -/)
  assert.throws(() => assertCommandRequest('addRemote', { projectPath: '/p', remoteName: 'x', url: '--upload-pack=evil' }), /cannot start with -/)
  assert.throws(() => assertCommandRequest('addRemote', { projectPath: '/p', remoteName: 'x', url: 'ext::sh -c evil' }), /ext:: transport/)
})

test('addRemote refuses a URL that carries a password or token', () => {
  assert.throws(
    () => assertCommandRequest('addRemote', { projectPath: '/p', remoteName: 'x', url: 'https://user:s3cret@host/x' }),
    /password or token/
  )
  assert.throws(
    () => assertCommandRequest('addRemote', { projectPath: '/p', remoteName: 'x', url: 'https://ghp_TOKEN@github.com/me/x' }),
    /password or token/
  )
  assertCommandRequest('addRemote', { projectPath: '/p', remoteName: 'x', url: 'ssh://git@host/x' }) // user name only: fine
})
