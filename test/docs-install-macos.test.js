import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const doc = await readFile(new URL('../docs/install.md', import.meta.url), 'utf8')

test('install guide leads with the macOS one-liner and also documents download-then-run and uninstall', () => {
  assert.match(doc, /## macOS: install with a script/)
  assert.match(doc, /curl -fsSL https:\/\/github\.com\/MRI-Lab-Graz\/DataLad-desktop\/releases\/download\/v[^\s|]+\/install\.sh \| bash/)
  assert.match(doc, /bash install\.sh/)
  assert.match(doc, /rm -rf "\$HOME\/Applications\/DataLad Desktop\.app"/)
  assert.match(doc, /Apple silicon/)
})
