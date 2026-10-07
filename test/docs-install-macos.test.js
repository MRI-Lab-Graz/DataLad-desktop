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

test('README download section names the macOS install.sh', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  assert.match(readme, /\*\*macOS\*\* `install\.sh`/)
})

test('install guide no longer says macOS installs nothing, and says the script avoids the Gatekeeper dialog', () => {
  assert.doesNotMatch(doc, /Windows portable, macOS, and Linux:\*\* these builds/)
  assert.match(doc, /Windows portable and Linux:\*\* these builds/)
  assert.match(doc, /script install above[^]*?Only needed once/)
  assert.match(doc, /the \.dmg doesn't install them/i)
})

test('SECURITY.md describes the macOS install script and what it does not pin', async () => {
  const sec = await readFile(new URL('../SECURITY.md', import.meta.url), 'utf8')
  assert.match(sec, /\*\*macOS install script\*\*/)
  assert.match(sec, /Homebrew/)
  assert.match(sec, /not pinned/i)
})

test('the version and changelog agree on 0.5.1 and the example URL uses it', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const log = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
  assert.equal(pkg.version, '0.5.1')
  assert.match(log, /^## 0\.5\.1$/m)
  assert.doesNotMatch(log, /^## Unreleased$/m)
  assert.ok(doc.includes(`download/v${pkg.version}/install.sh`))
})
