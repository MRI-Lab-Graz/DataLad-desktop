import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const html = read('src/gui/renderer/index.html')
const app = read('src/gui/renderer/app.js')

test('Save no longer has manual file paths', () => {
  assert.doesNotMatch(html, /id="paths"/)
  assert.doesNotMatch(html, /manual file paths/i)
  assert.doesNotMatch(app, /elements\.paths|parsePaths|manual paths/)
})
