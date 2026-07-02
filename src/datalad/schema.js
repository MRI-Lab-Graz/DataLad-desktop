export const ADAPTER_INTERFACE_VERSION = '0.5.0'

export const COMMAND_SCHEMAS = Object.freeze({
  cloneInstall: {
    required: ['source', 'targetPath'],
    optional: []
  },
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
  },
  createBranchAt: {
    required: ['projectPath', 'branchName', 'startPoint'],
    optional: []
  }
})

const RESULT_BASE_FIELDS = ['command', 'args', 'exitCode', 'stdout', 'stderr', 'failed']
const LEADING_DASH_FIELDS = Object.freeze({
  createBranch: ['branchName'],
  switchBranch: ['branchName'],
  createBranchAt: ['branchName', 'startPoint']
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
    commands: COMMAND_SCHEMAS
  }
}