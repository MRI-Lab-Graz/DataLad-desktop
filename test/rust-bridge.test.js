import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tryLoadRustAdapter } from '../src/datalad/rust-bridge.js'

const RUST_FLAG = 'DATALAD_DESKTOP_USE_RUST_ADAPTER'

function withRustFlag(value, fn) {
  const previous = process.env[RUST_FLAG]

  if (value === undefined) {
    delete process.env[RUST_FLAG]
  } else {
    process.env[RUST_FLAG] = value
  }

  const restore = () => {
    if (previous === undefined) {
      delete process.env[RUST_FLAG]
    } else {
      process.env[RUST_FLAG] = previous
    }
  }

  return Promise.resolve()
    .then(fn)
    .finally(restore)
}

async function hasBuiltLocalNativeAddon() {
  const nativeDir = join(process.cwd(), 'native', 'rust-core-node')

  try {
    const entries = await readdir(nativeDir)
    return entries.some((entry) => entry.endsWith('.node'))
  } catch {
    return false
  }
}

test('tryLoadRustAdapter is disabled when feature flag is not set', async () => {
  await withRustFlag(undefined, async () => {
    const result = tryLoadRustAdapter()

    assert.equal(result.enabled, false)
    assert.match(result.reason ?? '', /DATALAD_DESKTOP_USE_RUST_ADAPTER/) 
  })
})

test('tryLoadRustAdapter reports useful status when feature flag is enabled', async () => {
  await withRustFlag('1', async () => {
    const result = tryLoadRustAdapter()
    const hasAddon = await hasBuiltLocalNativeAddon()

    if (hasAddon) {
      assert.equal(result.enabled, true)
      assert.ok(result.adapter)
      assert.equal(typeof result.adapter.checkEnvironment, 'function')
      return
    }

    assert.equal(result.enabled, false)
    assert.match(result.reason ?? '', /Could not load Rust adapter/) 
  })
})
