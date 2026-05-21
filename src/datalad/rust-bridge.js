import { createRequire } from 'node:module'
import { getAdapterInterfaceContract } from './schema.js'

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

export function validateRustAdapterContract(adapter) {
  try {
    const rustContract = adapter.getInterfaceContract()
    const jsContract = getAdapterInterfaceContract()

    if (!rustContract || typeof rustContract !== 'object') {
      return 'adapter.getInterfaceContract() did not return an object'
    }

    if (rustContract.version !== jsContract.version) {
      return `interface version mismatch (rust=${rustContract.version ?? 'unknown'}, js=${jsContract.version})`
    }

    const rustCommandNames = Object.keys(rustContract.commands ?? {}).sort()
    const jsCommandNames = Object.keys(jsContract.commands ?? {}).sort()
    if (rustCommandNames.join(',') !== jsCommandNames.join(',')) {
      return 'supported command set mismatch between Rust and JavaScript adapters'
    }

    return null
  } catch (error) {
    return `contract validation failed: ${error?.message ?? String(error)}`
  }
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

      const compatibilityError = validateRustAdapterContract(adapter)
      if (compatibilityError) {
        errors.push(`${modulePath}: ${compatibilityError}`)
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
