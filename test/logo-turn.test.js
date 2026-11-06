import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { quarterTurn } from '../src/gui/renderer/logo-turn.js'

const read = (p) => readFileSync(new URL(`../src/gui/renderer/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('the logo turns by a quarter: 0, 90, 180 or 270 degrees, each equally likely', () => {
  assert.equal(quarterTurn(() => 0), 0)
  assert.equal(quarterTurn(() => 0.26), 90)
  assert.equal(quarterTurn(() => 0.51), 180)
  assert.equal(quarterTurn(() => 0.99), 270)
  const seen = new Set()
  for (let i = 0; i < 400; i++) seen.add(quarterTurn())
  assert.deepEqual([...seen].sort((a, b) => a - b), [0, 90, 180, 270])
})

test('a bad random source never gives a wrong angle', () => {
  for (const bad of [() => NaN, () => 1, () => -1, () => undefined]) assert.ok([0, 90, 180, 270].includes(quarterTurn(bad)))
})

test('the page turns the header logo once at start-up, through a CSS variable', () => {
  const app = read('app.js'), css = read('styles.css')
  assert.match(app, /import \{ quarterTurn \} from '\.\/logo-turn\.js'/)
  assert.match(app, /document\.documentElement\.style\.setProperty\('--logo-turn', `\$\{quarterTurn\(\)\}deg`\)/)
  assert.match(css, /\.hero-logo\s*\{[^}]*transform:\s*rotate\(var\(--logo-turn,\s*0deg\)\)/)
})
