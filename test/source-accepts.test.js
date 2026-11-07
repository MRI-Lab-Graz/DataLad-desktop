import test from 'node:test'
import assert from 'node:assert/strict'
import { withSessionAnswer, isSourceRefusal } from '../src/gui/renderer/source-accepts.js'
import { computeRemoteGating } from '../src/gui/renderer/button-gating.js'

test('"Not sure" acts like yes for this project in this session only, and never overrides a stored answer', () => {
  const notSure = new Set(['/a'])
  assert.equal(withSessionAnswer({ projectPath: '/a', sourceAccepts: null }, notSure).sourceAccepts, 'yes')
  assert.equal(withSessionAnswer({ projectPath: '/b', sourceAccepts: null }, notSure).sourceAccepts, null)
  assert.equal(withSessionAnswer({ projectPath: '/a', sourceAccepts: 'no' }, notSure).sourceAccepts, 'no')
  assert.equal(withSessionAnswer(null, notSure), null)
})

const push = (stderr, extra = {}) => ({ ok: false, commandName: 'push', stderr, stdout: '', userError: { code: 'AUTH_FAILED', technicalDetails: stderr }, ...extra })

test('only a real permission refusal of the push teaches that the source does not accept changes', () => {
  for (const text of [
    'remote: Permission to OpenNeuroDatasets/ds003612.git denied to someone.\nfatal: unable to access',
    "fatal: unable to access 'https://github.com/x/y.git/': The requested URL returned error: 403"
  ]) {
    assert.equal(isSourceRefusal('push', push(text)), true, text)
  }
  assert.equal(isSourceRefusal('push', { ok: false, stdout: 'remote: Permission to a/b.git denied to me.', stderr: '', userError: { code: 'AUTH_FAILED' } }), true)
})

test('login problems, special-remote errors, USB errors and network failures never teach it', () => {
  for (const text of [
    'fatal: Authentication failed for https://github.com/x/y.git/',
    "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    'S3 error: Forbidden (amazonaws.com)',
    'copy(error) Forbidden [special remote s3]',
    'rsync: mkdir "/Volumes/USB/x" failed: Permission denied',
    'fatal: unable to access: Operation timed out',
    'Could not resolve host: github.com'
  ]) {
    assert.equal(isSourceRefusal('push', push(text)), false, text)
  }
  const refused = push('remote: Permission to a/b.git denied to me.')
  assert.equal(isSourceRefusal('pushTags', refused), false)
  assert.equal(isSourceRefusal('push', { ...refused, cancelled: true }), false)
  assert.equal(isSourceRefusal('push', { ...refused, ok: true }), false)
  assert.equal(isSourceRefusal('push', null), false)
})

test('Add a Remote stays reachable while the source does not accept changes', () => {
  const health = { hasUpstream: true, upstream: 'origin/main', sourceAccepts: 'no' }
  assert.equal(computeRemoteGating(health).addRemote.hidden, false)
  assert.equal(computeRemoteGating({ ...health, sourceAccepts: 'yes' }).addRemote.hidden, true)
  assert.equal(computeRemoteGating({ ...health, sourceAccepts: null }).addRemote.hidden, true)
})
