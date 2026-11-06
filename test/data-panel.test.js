import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatBytes, renderDataPanel } from '../src/gui/renderer/data-panel.js'

const groups = [{ key: 'sub', title: 'Subjects', hint: 'sub-', values: ['sub-01', 'sub-02'] }]
const some = { count: 2, bytes: 1.4e9, unknownSize: 0 }
const none = { count: 0, bytes: 0, unknownSize: 0 }
const render = (o = {}) => renderDataPanel({ groups, selection: {}, summary: some, mode: 'get', ...o })

test('panel hides groups the data does not have', () => {
  assert.doesNotMatch(render({ groups: [] }), /<fieldset/)
  assert.doesNotMatch(render({ groups: [{ key: 'x', title: 'X', hint: '', values: [] }] }), /<fieldset/)
  assert.match(render(), /<fieldset/)
})

test('panel escapes values', () => {
  const g = [{ key: 'sub', title: 'Subjects', hint: 'sub-', values: ['<b>x</b>', 'a"b'] }]
  const html = render({ groups: g })
  assert.doesNotMatch(html, /<b>x/)
  assert.match(html, /data-value="&lt;b&gt;x&lt;\/b&gt;"/)
  assert.match(html, /data-value="a&quot;b"/)
})

test('buttons are disabled with an empty selection', () => {
  const html = render({ summary: none })
  assert.match(html, /id="data-panel-download"[^>]*disabled/)
  assert.match(html, /id="data-panel-free"[^>]*disabled/)
  assert.match(html, /Nothing chosen yet/)
  assert.doesNotMatch(render(), /disabled/)
})

test('summary says size unknown', () => {
  assert.match(render({ summary: { count: 5, bytes: 1500, unknownSize: 2 } }), /5 files, about 1\.5 KB, size unknown for 2 files/)
  assert.match(render(), /2 files, about 1\.4 GB/)
  assert.match(render(), /aria-live="polite"/)
})

test('checked state follows the selection', () => {
  const html = render({ selection: { sub: new Set(['sub-02']) } })
  assert.match(html, /data-value="sub-02"[^>]*checked/)
  assert.doesNotMatch(html, /data-value="sub-01"[^>]*checked/)
  assert.match(html, /data-group-all="sub"/)
  assert.match(html, /data-group-none="sub"/)
})

test('unknown-size-only summary does not claim 0 B; empty hint has no parentheses; TB unit', () => {
  assert.match(render({ summary: { count: 2, bytes: 0, unknownSize: 2 } }), />2 files, size unknown</)
  assert.doesNotMatch(render({ summary: { count: 2, bytes: 0, unknownSize: 2 } }), /about/)
  const g = [{ key: 'x', title: 'Things', hint: '', values: ['a', 'b'] }]
  assert.match(render({ groups: g }), /<legend>Things<\/legend>/)
  assert.equal(formatBytes(2.5e12), '2.5 TB')
})

test('formatBytes', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(999), '999 B')
  assert.equal(formatBytes(1500), '1.5 KB')
  assert.equal(formatBytes(1.4e9), '1.4 GB')
  assert.equal(formatBytes(1.5e9), '1.5 GB')
  assert.equal(formatBytes(5e12), '5.0 TB')
})

const main = readFileSync(new URL('../src/gui/main.js', import.meta.url), 'utf8')
const preload = readFileSync(new URL('../src/gui/preload.js', import.meta.url), 'utf8')

test('listDataFiles IPC checks the project root before listing', () => {
  const at = main.indexOf("handle('adapter:listDataFiles'")
  assert.ok(at > 0)
  const body = main.slice(at, at + 250)
  assert.ok(body.indexOf('requireAuthorizedRoot(') > 0 && body.indexOf('requireAuthorizedRoot(') < body.indexOf('adapter.listDataFiles('))
  assert.match(preload, /listDataFiles: \(projectPath\) => ipcRenderer\.invoke\('adapter:listDataFiles', projectPath\)/)
})

test('reckless dialog previews the first 5 paths', () => {
  const block = main.slice(main.indexOf("payload.commandName === 'dropReckless'"))
  assert.match(block, /previewPaths\(payload\.request\.paths\)/)
  assert.match(main, /from '\.\/reckless-preview\.js'/)
})
