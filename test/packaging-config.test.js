import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

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
