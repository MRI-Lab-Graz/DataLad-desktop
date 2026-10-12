import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatAge } from '../src/gui/renderer/relative-age.js'

const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

test('formatAge: under a minute is "just now", never "just now ago"', () => {
  assert.equal(formatAge(0), 'just now')
  assert.equal(formatAge(59 * 1000), 'just now')
})

test('formatAge: minutes, hours, days, weeks with "ago" and singulars', () => {
  assert.equal(formatAge(MIN), '1 minute ago')
  assert.equal(formatAge(5 * MIN), '5 minutes ago')
  assert.equal(formatAge(HOUR), '1 hour ago')
  assert.equal(formatAge(3 * HOUR), '3 hours ago')
  assert.equal(formatAge(DAY), '1 day ago')
  assert.equal(formatAge(6 * DAY), '6 days ago')
  assert.equal(formatAge(7 * DAY), '1 week ago')
  assert.equal(formatAge(30 * DAY), '4 weeks ago')
})

test('formatAge: negative ages (clock skew) count as just now', () => {
  assert.equal(formatAge(-5000), 'just now')
})

test('app.js no longer appends " ago" itself', () => {
  const app = readFileSync(new URL('../src/gui/renderer/app.js', import.meta.url), 'utf8')
  assert.doesNotMatch(app, /\} ago/)
  assert.doesNotMatch(app, /function formatAgeFromMilliseconds/)
})
