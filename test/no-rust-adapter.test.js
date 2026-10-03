// The optional Rust adapter was removed: a second implementation of every command
// to keep in sync, plus an env var that could load a native module from the
// node_modules lookup path. Nothing of it may linger.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { DataLadAdapter } from '../src/datalad/adapter.js'
import * as schema from '../src/datalad/schema.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('the Rust crates, bridge, parity tests and workflow are gone', () => {
  for (const path of [
    'rust-core', 'native', 'src/datalad/rust-bridge.js',
    'test/rust-bridge.test.js', 'test/adapter-parity.test.js', '.github/workflows/rust-bridge-validation.yml'
  ]) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, `${path} still exists`)
  }
})

test('nothing loads or configures a native adapter', () => {
  assert.doesNotMatch(read('src/gui/main.js'), /(^|[^a-z])rust|DATALAD_DESKTOP_USE_RUST_ADAPTER/i)
  assert.doesNotMatch(read('package.json'), /(^|[^a-z])rust|cargo/i)
})

// The contract existed only so the UI could detect a Rust adapter lacking JS-only commands.
test('the adapter interface contract is gone from the adapter, schema, IPC and preload', () => {
  assert.equal(new DataLadAdapter().getInterfaceContract, undefined)
  assert.equal(schema.getAdapterInterfaceContract, undefined)
  assert.equal(schema.ADAPTER_INTERFACE_VERSION, undefined)
  assert.doesNotMatch(read('src/gui/main.js'), /getContract/)
  assert.doesNotMatch(read('src/gui/preload.js'), /getContract/)
  assert.doesNotMatch(read('src/gui/renderer/app.js'), /getContract|extendedCommands/)
})
