import test from 'node:test'
import assert from 'node:assert/strict'
import { mapCommandError } from '../src/datalad/errors.js'

test('mapCommandError maps branch-already-exists output for createBranch', () => {
  const result = mapCommandError('createBranch', { stderr: "fatal: a branch named 'feature' already exists" })
  assert.equal(result.code, 'BRANCH_EXISTS')
})

test('mapCommandError maps unknown revision output for switchBranch', () => {
  const result = mapCommandError('switchBranch', { stderr: "error: pathspec 'missing' did not match any file(s) known to git" })
  assert.equal(result.code, 'BRANCH_NOT_FOUND')
})

test('mapCommandError maps dirty worktree output for branch commands', () => {
  for (const commandName of ['createBranch', 'switchBranch']) {
    const result = mapCommandError(commandName, { stderr: 'error: Your local changes would be overwritten by checkout' })
    assert.equal(result.code, 'WORKTREE_DIRTY')
  }
})

test('mapCommandError maps merge conflict output for update and branch commands', () => {
  for (const commandName of ['update', 'switchBranch', 'createBranch']) {
    const result = mapCommandError(commandName, { stderr: 'error: you need to resolve your current index first' })
    assert.equal(result.code, 'MERGE_CONFLICT')
  }
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
