import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const RUST_ADAPTER_ENABLE_ENV = 'DATALAD_DESKTOP_USE_RUST_ADAPTER'
const RUST_ADAPTER_PACKAGE = '@datalad-desktop/rust-core'
const RUST_ADAPTER_LOCAL_PACKAGE = '../../native/rust-core-node'

function isRustAdapterEnabledByEnv() {
  return process.env[RUST_ADAPTER_ENABLE_ENV] === '1'
}

function hasAdapterShape(candidate) {
  return candidate &&
    typeof candidate.checkEnvironment === 'function' &&
    typeof candidate.detectProject === 'function' &&
    typeof candidate.runCommand === 'function' &&
    typeof candidate.getInterfaceContract === 'function'
}

export function tryLoadRustAdapter() {
  if (!isRustAdapterEnabledByEnv()) {
    return {
      enabled: false,
      reason: `${RUST_ADAPTER_ENABLE_ENV} is not set to 1.`
    }
  }

  const loadAttempts = [RUST_ADAPTER_PACKAGE, RUST_ADAPTER_LOCAL_PACKAGE]
  const errors = []

  for (const modulePath of loadAttempts) {
    try {
      const nativeModule = require(modulePath)
      const adapter =
        typeof nativeModule?.createAdapter === 'function'
          ? nativeModule.createAdapter()
          : nativeModule?.adapter

      if (!hasAdapterShape(adapter)) {
        errors.push(`${modulePath}: module loaded but adapter interface was incomplete`)
        continue
      }

      return {
        enabled: true,
        adapter,
        reason: null
      }
    } catch (error) {
      errors.push(`${modulePath}: ${error?.message ?? String(error)}`)
    }
  }

  return {
    enabled: false,
    reason: [
      `Could not load Rust adapter from ${RUST_ADAPTER_PACKAGE} or ${RUST_ADAPTER_LOCAL_PACKAGE}.`,
      ...errors
    ].join(' ')
  }
}
