import test from 'node:test'
import assert from 'node:assert/strict'
import { guardedHandler, isTrustedSender } from '../src/gui/ipc-guard.js'

const APP = 'file:///opt/app/src/gui/renderer/index.html'
const from = (url, parent = null) => ({ senderFrame: { url, parent } })

test('isTrustedSender accepts the app page, ignoring query and hash', () => {
  assert.equal(isTrustedSender(from(APP), APP), true)
  assert.equal(isTrustedSender(from(`${APP}?x=1#top`), APP), true)
})

test('isTrustedSender rejects any other page, sub-frames and missing frames', () => {
  assert.equal(isTrustedSender(from('https://evil.example/'), APP), false)
  assert.equal(isTrustedSender(from('file:///tmp/dataset/readme.html'), APP), false)
  assert.equal(isTrustedSender(from(APP, { url: APP }), APP), false)
  assert.equal(isTrustedSender({}, APP), false)
  assert.equal(isTrustedSender(from('not a url'), APP), false)
})

test('guardedHandler runs the handler for the app page and throws for anything else', async () => {
  const handler = guardedHandler(APP, async (_event, value) => `ok:${value}`)
  assert.equal(await handler(from(APP), 7), 'ok:7')
  await assert.rejects(async () => handler(from('https://evil.example/'), 7), /untrusted sender/i)
})
