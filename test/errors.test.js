import test from 'node:test'
import assert from 'node:assert/strict'
import { mapCommandError } from '../src/datalad/errors.js'

test('mapCommandError maps non-empty target output for createProject from stderr', () => {
  const result = mapCommandError('createProject', { stderr: 'target directory ... is not empty' })
  assert.equal(result.code, 'TARGET_NOT_EMPTY')
})

test('mapCommandError maps non-empty target output for createProject from stdout', () => {
  // datalad reports this as a create(error) result line on stdout, not stderr.
  const result = mapCommandError('createProject', {
    stdout: 'create(error): /tmp/proj (dataset) [will not create a dataset in a non-empty directory, ' +
      'use `--force` option to ignore]',
    stderr: ''
  })
  assert.equal(result.code, 'TARGET_NOT_EMPTY')
  assert.match(result.technicalDetails, /non-empty directory/)
})

test('mapCommandError maps branch-already-exists output for createBranch', () => {
  const result = mapCommandError('createBranch', { stderr: "fatal: a branch named 'feature' already exists" })
  assert.equal(result.code, 'BRANCH_EXISTS')
})

test('mapCommandError maps branch-already-exists output for createBranchAt', () => {
  const result = mapCommandError('createBranchAt', { stderr: "fatal: a branch named 'restore/2024' already exists" })
  assert.equal(result.code, 'BRANCH_EXISTS')
})

test('mapCommandError maps unknown-revision output for createBranchAt', () => {
  const result = mapCommandError('createBranchAt', { stderr: 'fatal: Not a valid object name: abc1234' })
  assert.equal(result.code, 'INVALID_START_POINT')
})

test('mapCommandError maps unknown revision output for switchBranch', () => {
  const result = mapCommandError('switchBranch', { stderr: "error: pathspec 'missing' did not match any file(s) known to git" })
  assert.equal(result.code, 'BRANCH_NOT_FOUND')
})

test('mapCommandError maps dirty worktree output for branch commands', () => {
  for (const commandName of ['createBranch', 'createBranchAt', 'switchBranch']) {
    const result = mapCommandError(commandName, { stderr: 'error: Your local changes would be overwritten by checkout' })
    assert.equal(result.code, 'WORKTREE_DIRTY')
  }
})

test('mapCommandError maps merge conflict output for update and branch commands', () => {
  for (const commandName of ['update', 'switchBranch', 'createBranch', 'createBranchAt']) {
    const result = mapCommandError(commandName, { stderr: 'error: you need to resolve your current index first' })
    assert.equal(result.code, 'MERGE_CONFLICT')
  }
})

test('mapCommandError maps a leftover git index lock regardless of command', () => {
  const result = mapCommandError('save', {
    stderr: "fatal: Unable to create '/tmp/proj/.git/index.lock': File exists."
  })
  assert.equal(result.code, 'REPO_LOCKED')
})

test('mapCommandError maps in-progress merge output regardless of command', () => {
  const result = mapCommandError('update', { stderr: 'fatal: You have not concluded your merge (MERGE_HEAD exists)' })
  assert.equal(result.code, 'MERGE_IN_PROGRESS')
})

test('mapCommandError maps missing tooling output', () => {
  const result = mapCommandError('save', { stderr: 'spawn datalad ENOENT' })
  assert.equal(result.code, 'TOOLING_MISSING')
})

test('mapCommandError maps missing remote output', () => {
  const result = mapCommandError('push', { stderr: 'fatal: No configured push target.' })
  assert.equal(result.code, 'REMOTE_MISSING')
})

test('mapCommandError maps authentication failures', () => {
  const result = mapCommandError('push', { stderr: 'remote: Permission denied. fatal: Authentication failed' })
  assert.equal(result.code, 'AUTH_FAILED')
})

test('mapCommandError maps unavailable content for get', () => {
  const result = mapCommandError('get', { stderr: 'this content is not available from any configured remote' })
  assert.equal(result.code, 'CONTENT_UNAVAILABLE')
})

test('mapCommandError falls back to a generic unknown error', () => {
  const result = mapCommandError('save', { stderr: 'something unexpected happened' })
  assert.equal(result.code, 'UNKNOWN')
  assert.equal(result.technicalDetails, 'something unexpected happened')
})

test('mapCommandError treats a missing stderr as empty text', () => {
  const result = mapCommandError('save', {})
  assert.equal(result.code, 'UNKNOWN')
  assert.equal(result.technicalDetails, '')
})

test('mapCommandError does not misclassify unrelated commands against branch-specific patterns', () => {
  const result = mapCommandError('save', { stderr: "fatal: a branch named 'feature' already exists" })
  assert.equal(result.code, 'UNKNOWN')
})

test('mapCommandError maps a cancelled run to a calm CANCELLED result for any command', () => {
  for (const commandName of ['save', 'cloneInstall', 'get', 'push']) {
    const result = mapCommandError(commandName, { cancelled: true, failed: true, stderr: 'fatal: Unable to create index.lock' })
    assert.equal(result.code, 'CANCELLED')
    assert.match(result.message, /Stopped by you/)
  }
})

test('get errors do not tell users to type datalad CLI commands', () => {
  const forbidden = mapCommandError('get', { stdout: 'get(error): file (forbidden)', stderr: '' })
  const unavailable = mapCommandError('get', { stdout: 'get(error): file (not available)', stderr: '' })
  assert.equal(forbidden.code, 'GET_FORBIDDEN')
  assert.equal(unavailable.code, 'CONTENT_UNAVAILABLE')
  assert.doesNotMatch(forbidden.message, /datalad siblings/)
  assert.doesNotMatch(unavailable.message, /datalad siblings/)
})

test('mapCommandError explains a drop refused because no other copy is verified', () => {
  const result = mapCommandError('drop', {
    stdout: 'drop(error): big.bin (file) [unsafe; Could not verify the existence of the 1 necessary copy.; ' +
      '(Use --reckless availability to override this check, or adjust numcopies.)]\n',
    stderr: ''
  })
  assert.equal(result.code, 'DROP_UNSAFE')
  assert.match(result.message, /nothing was removed/i)
  assert.match(result.technicalDetails, /necessary copy/)
})

test('mapCommandError maps an existing tag name', () => {
  const result = mapCommandError('createTag', { stderr: "fatal: tag 'v1.0' already exists" })
  assert.equal(result.code, 'TAG_EXISTS')
})

test('mapCommandError maps a remote name that is already taken', () => {
  const result = mapCommandError('addRemote', { stderr: "fatal: remote origin already exists." })
  assert.equal(result.code, 'REMOTE_EXISTS')
})
