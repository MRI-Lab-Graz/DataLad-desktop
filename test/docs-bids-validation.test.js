import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('the Setup card and the install guide say that BIDS is checked too, with no extra install', async () => {
  assert.match(await read('src/gui/renderer/index.html'), /follows the PRISM and BIDS structure/)
  const guide = await read('docs/install.md')
  assert.match(guide, /BIDS projects\*\* \(a `dataset_description\.json`/)
  assert.match(guide, /no extra install/i)
})

test('SECURITY.md says the BIDS validator ships inside the hash-locked environment', async () => {
  const sec = await read('SECURITY.md')
  assert.match(sec, /bids-validator-deno/)
})

test('the changelog lists the gate fix and BIDS checking', async () => {
  const log = await read('CHANGELOG.md')
  assert.match(log, /BIDS projects are now checked before every save/)
})
