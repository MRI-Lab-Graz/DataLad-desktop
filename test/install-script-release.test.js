import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// How the release carries the Windows install script: the unpacked app zip, install.cmd, and an install.ps1 whose
// version and hash CI filled in. The workflow is only run on tags, so its shape is pinned here.
const release = await readFile(new URL('../.github/workflows/build-os-artifacts.yml', import.meta.url), 'utf8')
const windowsJob = release.slice(release.indexOf('  windows:'), release.indexOf('  linux:'))
const publishJob = release.slice(release.indexOf('  publish-release:'))

test('the Windows job zips the unpacked app with the app at the zip root', () => {
  assert.ok(windowsJob.includes("Compress-Archive -Path 'dist/win-unpacked/*'"))
  assert.ok(windowsJob.includes('DataLad-Desktop-$version-win-x64.zip'))
})

test('install.ps1 is rendered from the zip that ships with it, after the zip exists', () => {
  const zip = windowsJob.indexOf('Compress-Archive')
  const render = windowsJob.indexOf('node scripts/render-install-script.mjs')
  assert.ok(zip !== -1 && render > zip)
  assert.ok(windowsJob.includes('Copy-Item scripts/windows/install.cmd dist/install.cmd'))
})

test('a release tag must equal the package version, because the script downloads from the tag', () => {
  assert.match(windowsJob, /refs\/tags\/v\$version/)
  assert.match(windowsJob, /throw/)
})

test('the Windows artifact carries the zip, install.cmd and install.ps1 under the release pattern name', () => {
  const upload = windowsJob.slice(windowsJob.indexOf('name: datalad-desktop-windows-x64'))
  for (const path of ['dist/*.exe', 'dist/*.zip', 'dist/install.cmd', 'dist/install.ps1']) {
    assert.ok(upload.includes(path), `artifact does not include ${path}`)
  }
})

test('SHA256SUMS, the attestation and the release files cover install.cmd and install.ps1', () => {
  assert.match(publishJob, /sha256sum [^\n]*\*\.cmd[^\n]*\*\.ps1/)
  for (const glob of ['release-assets/*.cmd', 'release-assets/*.ps1']) {
    assert.equal(publishJob.split(glob).length - 1, 2, `${glob} must be in both the attestation and the release files`)
  }
})
