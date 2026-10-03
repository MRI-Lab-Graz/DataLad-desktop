import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const html = await readFile(new URL('../src/gui/renderer/index.html', import.meta.url), 'utf8')
const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? ''
const directive = (name) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `))

test('the renderer CSP allows no scripts but its own files, no frames, no plugins', () => {
  assert.equal(directive('script-src'), "script-src 'self'")
  assert.equal(directive('frame-src'), "frame-src 'none'")
  assert.equal(directive('object-src'), "object-src 'none'")
  assert.equal(directive('base-uri'), "base-uri 'none'")
  assert.equal(directive('form-action'), "form-action 'none'")
  assert.equal(directive('connect-src'), "connect-src 'self'")
  assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*unsafe-inline/)
})
