import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// How the release carries the Windows install script: the unpacked app zip and one windows-install.cmd whose
// version and hash CI filled in. The workflow is only run on tags, so its shape is pinned here.
const release = await readFile(new URL('../.github/workflows/build-os-artifacts.yml', import.meta.url), 'utf8')
const windowsJob = release.slice(release.indexOf('  windows:'), release.indexOf('  linux:'))
const publishJob = release.slice(release.indexOf('  publish-release:'))

test('the Windows job zips the unpacked app with the app at the zip root', () => {
  assert.ok(windowsJob.includes("Compress-Archive -Path 'dist/win-unpacked/*'"))
  assert.ok(windowsJob.includes('Worldline-Desktop-$version-win-x64.zip'))
})

test('windows-install.cmd is rendered from the zip that ships with it, after the zip exists', () => {
  const zip = windowsJob.indexOf('Compress-Archive')
  const render = windowsJob.indexOf('node scripts/render-install-script.mjs')
  assert.ok(zip !== -1 && render > zip)
  assert.ok(windowsJob.includes('dist/windows-install.cmd scripts/windows/windows-install.cmd'))
  assert.ok(!windowsJob.includes('install.ps1'))
})

test('a release tag must equal the package version, because the script downloads from the tag', () => {
  assert.match(windowsJob, /refs\/tags\/v\$version/)
  assert.match(windowsJob, /throw/)
})

test('the Windows artifact carries the zip and windows-install.cmd under the release pattern name', () => {
  const upload = windowsJob.slice(windowsJob.indexOf('name: worldline-desktop-windows-x64'))
  for (const path of ['dist/Worldline-Desktop-*-win-x64.zip', 'dist/windows-install.cmd']) {
    assert.ok(upload.includes(path), `artifact does not include ${path}`)
  }
})

test('SHA256SUMS, the attestation and the release files cover windows-install.cmd', () => {
  assert.match(publishJob, /sha256sum [^\n]*\*\.cmd/)
  assert.ok(!publishJob.includes('*.ps1'))
  for (const glob of ['release-assets/*.cmd']) {
    assert.equal(publishJob.split(glob).length - 1, 2, `${glob} must be in both the attestation and the release files`)
  }
})

// Linux: the AppImage is the app, so linux-install.sh is rendered from it and carries its SHA-256.
const linuxJob = release.slice(release.indexOf('  linux:'), release.indexOf('  publish-release:'))

test('linux-install.sh is rendered from the AppImage that ships with it, after the AppImage is built', () => {
  const build = linuxJob.indexOf('npm run package:linux')
  const render = linuxJob.indexOf('node scripts/render-install-script.mjs')
  assert.ok(build !== -1 && render > build)
  assert.ok(linuxJob.includes('dist/linux-install.sh scripts/linux/linux-install.sh'))
  assert.match(linuxJob, /refs\/tags\/v\$version/)
})

test('the Linux artifact carries the AppImage and linux-install.sh', () => {
  const upload = linuxJob.slice(linuxJob.indexOf('name: worldline-desktop-linux'))
  for (const path of ['dist/*.AppImage', 'dist/linux-install.sh']) assert.ok(upload.includes(path), `artifact does not include ${path}`)
})
