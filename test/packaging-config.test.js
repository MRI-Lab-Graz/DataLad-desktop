import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { UV } from '../scripts/fetch-uv.mjs'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

// macOS is Apple-silicon only: no Intel (x64) build targets or release artifacts.
test('package.json has no macOS x64 build scripts', async () => {
  const { scripts } = JSON.parse(await read('package.json'))
  for (const [name, command] of Object.entries(scripts)) {
    assert.ok(!/mac/.test(name) || !/--x64/.test(command), `${name} builds macOS x64: ${command}`)
    assert.ok(!/mac:(x64|both)/.test(name + command), `${name} still references a macOS x64/both script`)
  }
  assert.equal(scripts['package:mac:arm64'], 'electron-builder --mac --arm64')
})

for (const file of ['.github/workflows/build-os-artifacts.yml', '.gitlab-ci.yml']) {
  test(`${file} builds macOS for Apple silicon only`, async () => {
    const text = await read(file)
    assert.doesNotMatch(text, /mac:both|mac:x64|Intel/)
    assert.match(text, /package:mac:arm64/)
  })
}

// checkout/setup-node v4 run on Node 20, which GitHub is deprecating.
test('workflows use Node 24-capable checkout and setup-node', async () => {
  const { readdir } = await import('node:fs/promises')
  for (const name of await readdir(new URL('../.github/workflows/', import.meta.url))) {
    const text = await read(`.github/workflows/${name}`)
    assert.doesNotMatch(text, /actions\/(checkout|setup-node)@v4/, `${name} still uses a v4 action`)
  }
})

test('uv is bundled for every build target with a pinned SHA-256', async () => {
  const pkg = JSON.parse(await read('package.json'))
  assert.deepEqual(pkg.build.extraResources, [{ from: 'build/uv', to: 'uv' }])
  for (const target of ['aarch64-apple-darwin', 'x86_64-pc-windows-msvc', 'x86_64-unknown-linux-gnu']) {
    assert.match(UV.targets[target].sha256, /^[0-9a-f]{64}$/, target)
  }
  assert.match(UV.version, /^\d+\.\d+\.\d+$/)
})

test('every packaging job fetches uv before electron-builder runs', async () => {
  const wf = await read('.github/workflows/build-os-artifacts.yml')
  for (const target of ['aarch64-apple-darwin', 'x86_64-pc-windows-msvc', 'x86_64-unknown-linux-gnu']) {
    assert.ok(wf.indexOf(`fetch-uv.mjs ${target}`) !== -1, `no fetch for ${target}`)
  }
})

test('Windows uninstall removes the app data folder that holds the managed env', async () => {
  assert.equal(JSON.parse(await read('package.json')).build.nsis.deleteAppDataOnUninstall, true)
})

// The signed app must not double as a general Node interpreter for local malware
// (ELECTRON_RUN_AS_NODE / NODE_OPTIONS / --inspect), and must load only its own asar.
test('Electron fuses lock the packaged app down', async () => {
  const { electronFuses } = JSON.parse(await read('package.json')).build
  assert.equal(electronFuses.runAsNode, false)
  assert.equal(electronFuses.enableNodeOptionsEnvironmentVariable, false)
  assert.equal(electronFuses.enableNodeCliInspectArguments, false)
  assert.equal(electronFuses.enableEmbeddedAsarIntegrityValidation, true)
  assert.equal(electronFuses.onlyLoadAppFromAsar, true)
  // Flipping fuses invalidates the arm64 signature; unsigned local builds are re-signed ad hoc instead of being killed on launch.
  assert.equal(electronFuses.resetAdHocDarwinSignature, true)
})

test('the package ships only runtime sources, not tests, docs or Rust build output', async () => {
  const { files } = JSON.parse(await read('package.json')).build
  assert.deepEqual(files, ['package.json', 'src/**/*'])
})

test('macOS entitlements are minimal and do not disable library validation', async () => {
  const plist = await read('build/entitlements.mac.plist')
  assert.match(plist, /cs\.allow-jit/)
  assert.doesNotMatch(plist, /disable-library-validation/)
})
