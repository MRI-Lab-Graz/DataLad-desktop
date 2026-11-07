import test from 'node:test'
import assert from 'node:assert/strict'
import { withSessionAnswer, isPushRefusal } from '../src/gui/renderer/source-accepts.js'
import { computeRemoteGating } from '../src/gui/renderer/button-gating.js'

test('"Not sure" acts like yes for this project in this session only, and never overrides a stored answer', () => {
  const notSure = new Set(['/a'])
  assert.equal(withSessionAnswer({ projectPath: '/a', sourceAccepts: null }, notSure).sourceAccepts, 'yes')
  assert.equal(withSessionAnswer({ projectPath: '/b', sourceAccepts: null }, notSure).sourceAccepts, null)
  assert.equal(withSessionAnswer({ projectPath: '/a', sourceAccepts: 'no' }, notSure).sourceAccepts, 'no')
  assert.equal(withSessionAnswer(null, notSure), null)
})

test('only a refused push teaches the app that the source does not accept changes', () => {
  const refused = { ok: false, userError: { code: 'AUTH_FAILED' } }
  assert.equal(isPushRefusal('push', refused), true)
  assert.equal(isPushRefusal('pushTags', refused), false)
  assert.equal(isPushRefusal('update', refused), false)
  assert.equal(isPushRefusal('push', { ok: false, userError: { code: 'NETWORK_ERROR' } }), false)
  assert.equal(isPushRefusal('push', { ok: false, cancelled: true, userError: { code: 'AUTH_FAILED' } }), false)
  assert.equal(isPushRefusal('push', { ok: true }), false)
  assert.equal(isPushRefusal('push', null), false)
})

test('Add a Remote stays reachable while the source does not accept changes', () => {
  const health = { hasUpstream: true, upstream: 'origin/main', sourceAccepts: 'no' }
  assert.equal(computeRemoteGating(health).addRemote.hidden, false)
  assert.equal(computeRemoteGating({ ...health, sourceAccepts: 'yes' }).addRemote.hidden, true)
  assert.equal(computeRemoteGating({ ...health, sourceAccepts: null }).addRemote.hidden, true)
})
