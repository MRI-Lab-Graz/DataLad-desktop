import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { escapeHtml } from '../src/gui/renderer/escape-html.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('escapeHtml neutralizes markup in text and in quoted attributes', () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert('1')"> & more`), '&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt; &amp; more')
  assert.equal(escapeHtml(undefined), 'undefined')
  assert.equal(escapeHtml(42), '42')
})

// The one escaping routine guards every innerHTML sink; a second copy can drift.
test('there is exactly one escapeHtml, imported by both renderer modules', () => {
  for (const file of ['src/gui/renderer/app.js', 'src/gui/renderer/run-activity.js']) {
    const text = read(file)
    assert.doesNotMatch(text, /function escapeHtml/, `${file} defines its own copy`)
    assert.match(text, /import \{[^}]*escapeHtml[^}]*\} from '\.\/escape-html\.js'/, `${file} must import it`)
  }
})

test('the process runner uses the platform setTimeout promise instead of a hand-rolled sleep', () => {
  const text = read('src/datalad/process-runner.js')
  assert.doesNotMatch(text, /function sleep/)
  assert.match(text, /from 'node:timers\/promises'/)
})
