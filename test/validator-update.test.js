import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PRISM_COOLDOWN_DAYS,
  compareVersions,
  parseVersion,
  pickRelease
} from '../src/datalad/validator-update.js'

const file = (time, yanked = false) => ({
  filename: 'x.whl',
  yanked,
  upload_time_iso_8601: time
})

const NOW = new Date('2026-11-04T12:00:00Z')
const fixture = {
  info: { name: 'prism-validator' },
  releases: {
    '1.19.1': [file('2026-09-01T10:00:00.123456Z')],
    '1.20.0': [file('2026-10-07T10:00:00.123456Z')],
    '1.21.0': [file('2026-10-20T10:00:00.000000Z'), file('2026-10-21T10:00:00.000000Z')],
    '1.21.1': [file('2026-11-03T10:00:00.000000Z')],
    '1.22.0rc1': [file('2026-10-01T10:00:00.000000Z')],
    '1.23.0': [file('2026-10-01T10:00:00.000000Z', true)],
    '1.24.0': []
  }
}

test('cooldown default is 3 days', () => {
  assert.equal(PRISM_COOLDOWN_DAYS, 3)
})

test('parseVersion finds the first dotted number', () => {
  assert.equal(parseVersion('prism-validator 1.19.1'), '1.19.1')
  assert.equal(parseVersion(null), null)
  assert.equal(parseVersion('no version here'), null)
})

test('compareVersions compares numerically, missing parts are 0', () => {
  assert.ok(compareVersions('1.9.0', '1.20.0') < 0)
  assert.equal(compareVersions('1.20', '1.20.0'), 0)
  assert.ok(compareVersions('2.0', '1.20.0') > 0)
})

test('pickRelease skips pre-releases, too-new, yanked and empty releases', () => {
  const r = pickRelease(fixture, { now: NOW, cooldownDays: 3 })
  assert.equal(r.version, '1.21.0')
  assert.equal(r.cutoff, '2026-11-01T12:00:00.000Z')
})

test('pickRelease returns null for malformed input', () => {
  for (const bad of [{}, null, 'x', { releases: {} }, { releases: { '1.0': 'oops' } }]) {
    assert.equal(pickRelease(bad, { now: NOW, cooldownDays: 3 }), null)
  }
})
