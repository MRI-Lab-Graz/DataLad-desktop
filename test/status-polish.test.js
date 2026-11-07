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

test('BIDS/PRISM badge: two-class ok/bad rules exist with the green/red colours', () => {
  const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const ok = ruleBody(css, '.badge-bids.badge-ok')
  const bad = ruleBody(css, '.badge-bids.badge-bad')
  // two classes = higher specificity than the single-class .badge-bids that comes later
  assert.ok(ok, 'rule .badge-bids.badge-ok exists')
  assert.ok(bad, 'rule .badge-bids.badge-bad exists')
  assert.match(ok, /background:\s*#e3f3e6/i)
  assert.match(ok, /color:\s*#1f6b34/i)
  assert.match(bad, /background:\s*#fbe3e3/i)
  assert.match(bad, /color:\s*#9b1c1c/i)
})

test('the last-action message has a heading right before the pill', () => {
  const html = read('index.html')
  assert.match(
    html,
    /<div class="strip-state-group strip-state-column">\s*<p class="strip-label">Last action<\/p>\s*<span id="last-action-state"/
  )
})

test('only the last-action group stacks; the project badges group stays a row', () => {
  const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const html = read('index.html')
  assert.doesNotMatch(ruleBody(css, '.strip-state-group'), /flex-direction:\s*column/)
  assert.match(ruleBody(css, '.strip-state-column') || '', /flex-direction:\s*column/)
  const groups = [...html.matchAll(/<div class="(strip-state-group[^"]*)">([\s\S]*?)<\/div>/g)]
  const tools = groups.find((g) => g[2].includes('id="open-tools"'))
  const last = groups.find((g) => g[2].includes('id="last-action-state"'))
  assert.ok(tools && last)
  assert.doesNotMatch(tools[1], /strip-state-column/)
  assert.match(last[1], /strip-state-column/)
})
