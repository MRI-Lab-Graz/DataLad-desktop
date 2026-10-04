import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConsoleConsent } from '../src/gui/console-consent.js'

const fileIn = async () => join(await mkdtemp(join(tmpdir(), 'consent-')), 'console-consent.json')
const answer = (yes) => {
  const calls = { n: 0 }
  return { calls, confirm: async () => { calls.n += 1; return yes } }
}

test('turning the console on asks, and a no keeps it off', async () => {
  const file = await fileIn()
  const no = answer(false)
  assert.equal(await createConsoleConsent({ file }).allow(true, no.confirm), false)
  assert.equal(no.calls.n, 1)
})

test('a yes is remembered, so restoring the saved power-user setting at launch does not ask again', async () => {
  const file = await fileIn()
  const yes = answer(true)
  assert.equal(await createConsoleConsent({ file }).allow(true, yes.confirm), true)
  const later = answer(false)
  assert.equal(await createConsoleConsent({ file }).allow(true, later.confirm), true)
  assert.equal(later.calls.n, 0)
})

test('turning the console off forgets the consent, so a page that switches it on again must ask', async () => {
  const file = await fileIn()
  await createConsoleConsent({ file }).allow(true, answer(true).confirm)
  const consent = createConsoleConsent({ file })
  assert.equal(await consent.allow(false, answer(true).confirm), false)
  const again = answer(false)
  assert.equal(await consent.allow(true, again.confirm), false)
  assert.equal(again.calls.n, 1)
})

test('with no consent file at all (what a compromised page starts from) turning it on asks', async () => {
  const yes = answer(false)
  await createConsoleConsent({ file: await fileIn() }).allow(true, yes.confirm)
  assert.equal(yes.calls.n, 1)
})
