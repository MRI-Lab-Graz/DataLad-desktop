import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describeUpdates } from '../src/gui/renderer/update-notice.js'

const notice = { tool: 'datalad', installed: '1.7.0', latest: '99.0.0', message: 'DataLad 99.0.0 is available.' }

test('disabled or missing status gives no lines', () => {
  assert.deepEqual(describeUpdates({ disabled: true, validator: { status: 'updated', from: '1', to: '2' }, notices: [notice] }), { lines: [] })
  assert.deepEqual(describeUpdates(null), { lines: [] })
  assert.deepEqual(describeUpdates({ disabled: false, validator: null, notices: [] }), { lines: [] })
})

test('updated validator names both versions', () => {
  const { lines } = describeUpdates({ disabled: false, validator: { status: 'updated', from: '1.0.0', to: '1.1.0' }, notices: [] })
  assert.deepEqual(lines, [{ text: 'prism-validator was updated from 1.0.0 to 1.1.0.' }])
})

test('failed validator update reassures', () => {
  const { lines } = describeUpdates({ disabled: false, validator: { status: 'failed', reason: 'x' }, notices: [] })
  assert.deepEqual(lines, [{ text: 'prism-validator has a newer version that could not be installed. The current one keeps working.' }])
})

test('notices carry a skip target', () => {
  const { lines } = describeUpdates({ disabled: false, validator: null, notices: [notice] })
  assert.deepEqual(lines, [{ text: notice.message, skip: { tool: 'datalad', version: '99.0.0' } }])
})

test('current, retry, deferred and unknown validator states say nothing', () => {
  for (const status of ['current', 'retry', 'deferred', 'offline', 'anything-new']) {
    assert.deepEqual(describeUpdates({ disabled: false, validator: { status }, notices: [] }), { lines: [] })
  }
})

// describeUpdates only returns plain strings; app.js renders them with textContent, so markup stays literal.
// (A DOM-level check is not possible: the fake feed cannot set `message`, tool-notices.js builds it from parsed versions.)
test('hostile strings come back unchanged as plain text', () => {
  const evil = '<img src=x onerror=alert(1)>'
  const { lines } = describeUpdates({
    disabled: false,
    validator: { status: 'updated', from: evil, to: evil },
    notices: [{ tool: 'datalad', installed: '1', latest: '2', message: evil }]
  })
  assert.equal(lines[0].text, `prism-validator was updated from ${evil} to ${evil}.`)
  assert.equal(lines[1].text, evil)
  assert.ok(lines.every((line) => Object.keys(line).every((key) => key === 'text' || key === 'skip')))
})

test('notice text keeps its line breaks (white-space: pre-line on the text span)', () => {
  const css = readFileSync(new URL('../src/gui/renderer/styles.css', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../src/gui/renderer/app.js', import.meta.url), 'utf8')
  assert.match(css, /\.update-row span\s*\{[^}]*white-space:\s*pre-line/)
  assert.match(app, /text\.textContent = line\.text/)
})

// After an update the Setup, PRISM Validator line ("Ready (1.20.0)") must not keep showing the old version.
test('an updated validator asks for the Setup status line to be refreshed; nothing else does', () => {
  assert.equal(describeUpdates({ disabled: false, validator: { status: 'updated', from: '1', to: '2' }, notices: [] }).refreshEnv, true)
  for (const status of ['failed', 'retry', 'current']) {
    assert.ok(!describeUpdates({ disabled: false, validator: { status }, notices: [] }).refreshEnv, status)
  }
  const app = readFileSync(new URL('../src/gui/renderer/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const body = app.slice(app.indexOf('async function refreshUpdateNotice'), app.indexOf('refreshUpdateNotice()\napi.onUpdatesChanged'))
  assert.match(body, /if \(refreshEnv\) refreshPrismEnvStatus\(\)\.catch\(/)
})

test('a newer validator release that is still waiting is reported as validatorNewer, never as a line', () => {
  const r = describeUpdates({ disabled: false, validator: { status: 'current', from: '1.23.2', newer: '1.24.0' }, notices: [] })
  assert.deepEqual(r, { lines: [], validatorNewer: '1.24.0' })
})

test('validatorNewer only accepts a plain version number, and is off when updates are off', () => {
  for (const newer of ['<img src=x>', '1.2.3; rm', '', undefined, 5]) {
    assert.deepEqual(describeUpdates({ disabled: false, validator: { status: 'current', newer }, notices: [] }), { lines: [] })
  }
  assert.deepEqual(describeUpdates({ disabled: true, validator: { status: 'current', newer: '1.24.0' }, notices: [] }), { lines: [] })
})

test('Setup card has the "Update now" button and its line; the page shows versions with textContent only', () => {
  const html = readFileSync(new URL('../src/gui/renderer/index.html', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../src/gui/renderer/app.js', import.meta.url), 'utf8')
  assert.match(html, /id="prism-update-now"[^>]*hidden/)
  assert.match(html, /id="prism-newer"[^>]*hidden/)
  assert.match(app, /elements\.prismNewer\.textContent =/)
  assert.doesNotMatch(app, /prismNewer\.innerHTML/)
})
