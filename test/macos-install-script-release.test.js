import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const release = await readFile(new URL('../.github/workflows/build-os-artifacts.yml', import.meta.url), 'utf8')
const macJob = release.slice(release.indexOf('  macos:'), release.indexOf('  windows:'))
const publishJob = release.slice(release.indexOf('  publish-release:'))

test('the macOS job zips the app with ditto, then renders install.sh from that zip', () => {
  const zip = macJob.indexOf('ditto -c -k --keepParent')
  const render = macJob.indexOf('node scripts/render-install-script.mjs')
  assert.ok(zip !== -1 && render > zip)
  assert.ok(macJob.includes('DataLad-Desktop-$version-mac-arm64.zip'))
  assert.ok(macJob.includes('scripts/macos/install.sh'))
})

test('a release tag must equal the package version, because the script downloads from the tag', () => {
  assert.match(macJob, /refs\/tags\/v\$version/)
})

test('the macOS artifact carries the arm64 zip and install.sh', () => {
  const upload = macJob.slice(macJob.indexOf('name: datalad-desktop-macos'))
  for (const p of ['dist/DataLad-Desktop-*-mac-arm64.zip', 'dist/install.sh']) {
    assert.ok(upload.includes(p), `artifact does not include ${p}`)
  }
})

test('SHA256SUMS, the attestation and the release files cover install.sh', () => {
  assert.match(publishJob, /sha256sum [^\n]*\*\.sh/)
  assert.equal(publishJob.split('release-assets/*.sh').length - 1, 2)
})
