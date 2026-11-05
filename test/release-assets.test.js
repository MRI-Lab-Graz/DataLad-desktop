import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'

// Releases are unsigned and signing is not coming soon, so the dmg / NSIS installer / portable exe (which
// only trigger Gatekeeper and SmartScreen) are gone. People install with install.sh or install.cmd, which download
// the app zip from the release and check its SHA-256; the Linux AppImage stays.
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8')
const exists = (p) => access(new URL(`../${p}`, import.meta.url)).then(() => true, () => false)

test('electron-builder only produces the unpacked app for macOS and Windows (the install scripts zip it)', async () => {
  const { build } = JSON.parse(await read('package.json'))
  assert.deepEqual(build.win.target, [{ target: 'dir', arch: ['x64'] }])
  assert.equal(build.mac.target, 'dir')
  assert.equal(build.nsis, undefined)
})

test('the NSIS installer and its smoke workflow are gone', async () => {
  assert.equal(await exists('build/installer.nsh'), false)
  assert.equal(await exists('.github/workflows/installer-smoke.yml'), false)
})

test('the release workflow neither builds nor publishes dmg, setup exe, portable exe or signing steps', async () => {
  const wf = await read('.github/workflows/build-os-artifacts.yml')
  for (const gone of ['*.dmg', '*.exe', '-mac.zip', 'SIGNPATH', 'signpath']) assert.ok(!wf.includes(gone), `workflow still mentions ${gone}`)
})

test('the release workflow still publishes the app zips, the install scripts, the AppImage and SHA256SUMS', async () => {
  const wf = await read('.github/workflows/build-os-artifacts.yml')
  const publish = wf.split('Create GitHub Release and upload assets')[1]
  for (const kept of ['*.zip', '*.cmd', '*.sh', '*.AppImage', 'SHA256SUMS.txt']) assert.ok(publish.includes(kept), `release no longer publishes ${kept}`)
})

test('the docs tell people to use the install scripts, not an installer or a portable exe', async () => {
  const doc = await read('docs/install.md')
  const readme = await read('README.md')
  for (const text of [doc, readme]) {
    assert.doesNotMatch(text, /\.dmg|Setup \*\.exe|portable/i)
    assert.doesNotMatch(text, /SmartScreen|Windows protected your PC/)
  }
})

test('the docs name the single Windows file, windows-install.cmd, and not install.cmd or install.ps1', async () => {
  for (const file of ['docs/install.md', 'README.md', 'SECURITY.md', 'REVIEW-OVERVIEW.md']) {
    const text = await read(file)
    assert.doesNotMatch(text, /(?<![-\w])install\.cmd|install\.ps1/, `${file} still names the old Windows files`)
  }
  assert.match(await read('docs/install.md'), /windows-install\.cmd/)
  assert.match(await read('README.md'), /windows-install\.cmd/)
})

test('there is one install file per system, with the same name in every release', async () => {
  const wf = await read('.github/workflows/build-os-artifacts.yml')
  for (const name of ['windows-install.cmd', 'macos-install.sh', 'linux-install.sh']) assert.ok(wf.includes(`dist/${name}`), `${name} is not built`)
  assert.equal(wf.includes('dist/install.sh'), false)
  assert.equal(await exists('scripts/macos/macos-install.sh'), true)
  assert.equal(await exists('scripts/macos/install.sh'), false)
  assert.equal(await exists('scripts/linux/linux-install.sh'), true)
})

test('the release text and the docs link each system to its file with releases/latest/download', async () => {
  const wf = await read('.github/workflows/build-os-artifacts.yml')
  const doc = await read('docs/install.md')
  const readme = await read('README.md')
  for (const name of ['windows-install.cmd', 'macos-install.sh', 'linux-install.sh']) {
    assert.ok(wf.includes(`releases/latest/download/${name}`), `release text lacks the link to ${name}`)
    assert.ok(doc.includes(`releases/latest/download/${name}`), `install guide lacks the link to ${name}`)
    assert.ok(readme.includes(name), `README lacks ${name}`)
  }
})
