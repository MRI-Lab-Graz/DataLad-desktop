import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldBlockForIdentity, identityMissingResult } from '../src/gui/renderer/identity-guard.js'
import { shouldStopSequence } from '../src/gui/renderer/run-activity.js'

const incomplete = { available: true, name: '', email: '', complete: false }
const complete = { available: true, name: 'Jane', email: 'j@lab.org', complete: true }

test('commit-creating commands are blocked while the identity is incomplete', () => {
  for (const command of ['save', 'createProject', 'createSubdataset', 'update']) {
    assert.equal(shouldBlockForIdentity(command, incomplete), true, command)
  }
})

test('other commands are never blocked by a missing identity', () => {
  for (const command of ['get', 'push', 'cloneInstall', 'switchBranch']) {
    assert.equal(shouldBlockForIdentity(command, incomplete), false, command)
  }
})

test('nothing is blocked when the identity is complete', () => {
  assert.equal(shouldBlockForIdentity('save', complete), false)
})

test('nothing is blocked before the identity has been read', () => {
  assert.equal(shouldBlockForIdentity('save', null), false)
})

test('nothing is blocked when git is not available (Check Environment reports that)', () => {
  assert.equal(shouldBlockForIdentity('save', { available: false, name: '', email: '', complete: false }), false)
})

test('identityMissingResult is a runner-shaped warning that stops sequences', () => {
  const result = identityMissingResult('save')
  assert.equal(result.ok, false)
  assert.equal(result.commandName, 'save')
  assert.equal(result.userError.code, 'IDENTITY_MISSING')
  assert.match(result.userError.message, /Set your name and email first/)
  assert.equal(shouldStopSequence(result), true)
})

test('creating a version needs a git identity (annotated tags record the tagger)', () => {
  assert.equal(shouldBlockForIdentity('createTag', { available: true, complete: false }), true)
})

test('merge and finishMerge create a commit, so they wait for an identity', () => {
  const missing = { available: true, complete: false }
  assert.equal(shouldBlockForIdentity('merge', missing), true)
  assert.equal(shouldBlockForIdentity('finishMerge', missing), true)
  assert.equal(shouldBlockForIdentity('abortMerge', missing), false)
})
