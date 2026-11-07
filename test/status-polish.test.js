import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../src/gui/renderer/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// Body of the first rule whose selector list contains exactly `sel`.
function ruleBody (css, sel) {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map((s) => s.trim()).includes(sel)) return m[2]
  }
  return null
}

test('a BIDS/PRISM badge turns green or red: ok/bad rules beat the later pink .badge-bids', () => {
  const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const ok = ruleBody(css, '.badge-bids.badge-ok')
  const bad = ruleBody(css, '.badge-bids.badge-bad')
  assert.ok(ok, 'rule .badge-bids.badge-ok exists')
  assert.ok(bad, 'rule .badge-bids.badge-bad exists')
  assert.match(ok, /background:\s*#e3f3e6/i)
  assert.match(ok, /color:\s*#1f6b34/i)
  assert.match(bad, /background:\s*#fbe3e3/i)
  assert.match(bad, /color:\s*#9b1c1c/i)
})
