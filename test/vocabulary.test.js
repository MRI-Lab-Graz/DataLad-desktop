import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const app = read('../src/gui/renderer/app.js')
const html = read('../src/gui/renderer/index.html')

test('no screen text still says Publish or Update for the two Sync actions', () => {
  for (const old of ['Published; sending', 'Published, but versions', 'Try Publish again', 'and published.', 'Project update finished', 'Publish Versions', 'Update and Publish against', 'a future Update', "'Publish to share it", 'once Publish worked']) {
    assert.ok(!app.includes(old), `app.js still has: ${old}`)
  }
  for (const old of ['Connect and Publish', 'The first Publish sends', 'Update, or Publish runs', 'Publish sends it to your remote', 'update, and publish', 'stops suggesting\n              Publish', 'Publish is always']) {
    assert.ok(!html.includes(old), `index.html still has: ${old}`)
  }
  for (const fresh of ['Sent your saves; sending versions was stopped.', 'Sent your saves, but versions could not be sent. Try Send my saves again.', 'and sent your saves.', 'Updates received.', "'Send Versions'", 'Get updates and Send my saves against']) {
    assert.ok(app.includes(fresh), `app.js lacks: ${fresh}`)
  }
  for (const fresh of ['Connect and send my saves', 'The first time, all your saves are sent.', 'after Save, Get Data, Get updates, or Send my saves runs', 'Send my saves sends it to your remote']) {
    assert.ok(html.includes(fresh), `index.html lacks: ${fresh}`)
  }
})
