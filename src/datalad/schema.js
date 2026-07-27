export const ADAPTER_INTERFACE_VERSION = '0.5.0'

// Commands in the stable Rust bridge contract — the Rust adapter must implement exactly these.
const BRIDGE_COMMAND_SCHEMAS = Object.freeze({
  cloneInstall: {
    required: ['source', 'targetPath'],
    optional: []
  },
  // `procedure`/`force` (BIDS mode) are intentionally NOT listed here even
  // though the JS adapter accepts them — they're JS-only extensions on top
  // of this bridge command, not part of the Rust-checked contract. Adding
  // them here would assert Rust parity that doesn't exist: the Rust adapter
  // hardcodes a plain `create -- targetPath` and ignores unknown fields
  // rather than rejecting them, and validateRustAdapterContract only checks
  // command names, not each command's required/optional fields, so it can't
  // catch that drift. Use `extendedCommands` (below) to gate BIDS UI instead.
  createProject: {
    required: ['targetPath'],
    optional: []
  },
  get: {
    required: ['projectPath'],
    optional: ['paths']
  },
  save: {
    required: ['projectPath', 'message'],
    optional: ['paths']
  },
  update: {
    required: ['projectPath'],
    optional: []
  },
  push: {
    required: ['projectPath'],
    optional: []
  },
  createBranch: {
    required: ['projectPath', 'branchName'],
    optional: []
  },
  switchBranch: {
    required: ['projectPath', 'branchName'],
    optional: []
  }
})

// JS-only extended commands — not part of the Rust bridge contract.
const EXTENDED_COMMAND_SCHEMAS = Object.freeze({
  createBranchAt: {
    required: ['projectPath', 'branchName', 'startPoint'],
    optional: []
  },
  restoreFileFromCommit: {
    required: ['projectPath', 'commitHash', 'paths'],
    optional: []
  },
  discardChanges: {
    required: ['projectPath', 'paths'],
    optional: []
  },
  unlock: {
    required: ['projectPath', 'paths'],
    optional: []
  },
  createSubdataset: {
    required: ['projectPath', 'relativePath'],
    optional: ['procedure', 'force']
  }
})

export const COMMAND_SCHEMAS = Object.freeze({ ...BRIDGE_COMMAND_SCHEMAS, ...EXTENDED_COMMAND_SCHEMAS })

const RESULT_BASE_FIELDS = ['command', 'args', 'exitCode', 'stdout', 'stderr', 'failed']
const LEADING_DASH_FIELDS = Object.freeze({
  createBranch: ['branchName'],
  switchBranch: ['branchName'],
  createBranchAt: ['branchName', 'startPoint'],
  createProject: ['procedure'],
  createSubdataset: ['procedure']
})

/**
 * @typedef {'cloneInstall' | 'get' | 'save' | 'update' | 'push' | 'createBranch' | 'switchBranch'} DataLadCommandName
 */

export function assertCommandRequest(commandName, request) {
  const schema = COMMAND_SCHEMAS[commandName]
  if (!schema) {
    throw new Error(`Unsupported command: ${commandName}`)
  }

  if (!request || typeof request !== 'object') {
    throw new Error(`Invalid request for ${commandName}: request must be an object`)
  }

  for (const field of schema.required) {
    const value = request[field]
    if (value === undefined || value === null || value === '') {
      throw new Error(`Invalid request for ${commandName}: missing required field ${field}`)
    }
  }

  if (Object.hasOwn(request, 'paths') && !Array.isArray(request.paths)) {
    throw new Error(`Invalid request for ${commandName}: paths must be an array`)
  }

  if (schema.required.includes('paths') && (request.paths?.length ?? 0) === 0) {
    throw new Error(`Invalid request for ${commandName}: paths must be a non-empty array`)
  }

  for (const field of LEADING_DASH_FIELDS[commandName] ?? []) {
    const value = request[field]
    if (typeof value === 'string' && value.trim().startsWith('-')) {
      throw new Error(`Invalid request for ${commandName}: ${field} cannot start with -`)
    }
  }

  for (const pathValue of request.paths ?? []) {
    if (typeof pathValue !== 'string' || !pathValue.trim()) {
      throw new Error(`Invalid request for ${commandName}: each path must be a non-empty string`)
    }
  }
}

export function assertRunnerResultShape(result) {
  for (const field of RESULT_BASE_FIELDS) {
    if (!Object.hasOwn(result, field)) {
      throw new Error(`Runner result is missing field: ${field}`)
    }
  }
}

export function buildCommandResult(commandName, runResult, userError = null, warnings = []) {
  assertRunnerResultShape(runResult)
  return {
    ok: !runResult.failed,
    commandName,
    ...runResult,
    userError,
    warnings
  }
}

export function getAdapterInterfaceContract() {
  return {
    version: ADAPTER_INTERFACE_VERSION,
    classificationValues: ['git', 'dataset', 'superdataset'],
    commands: BRIDGE_COMMAND_SCHEMAS,
    // Purely additive — validateRustAdapterContract (rust-bridge.js) only
    // compares `.version` and the key set of `.commands`, so this field is
    // safe to add without risking a false contract-mismatch under the Rust
    // adapter. The renderer uses it to feature-detect JS-only capabilities
    // (e.g. BIDS mode's createSubdataset) instead of assuming they exist.
    extendedCommands: Object.keys(EXTENDED_COMMAND_SCHEMAS)
  }
}