export const COMMAND_SCHEMAS = Object.freeze({
  cloneInstall: {
    required: ['source', 'targetPath'],
    optional: []
  },
  createProject: {
    required: ['targetPath'],
    optional: ['procedure', 'force']
  },
  get: {
    required: ['projectPath'],
    optional: ['paths']
  },
  drop: {
    required: ['projectPath'],
    optional: ['paths']
  },
  createTag: {
    required: ['projectPath', 'tagName', 'message', 'commitHash'],
    optional: []
  },
  pushTags: {
    required: ['projectPath', 'remoteName'],
    optional: []
  },
  verify: {
    required: ['projectPath'],
    optional: []
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
  },
  disconnectRemote: {
    required: ['projectPath', 'remoteName'],
    optional: []
  }
})

const RESULT_BASE_FIELDS = ['command', 'args', 'exitCode', 'stdout', 'stderr', 'failed']
const LEADING_DASH_FIELDS = Object.freeze({
  cloneInstall: ['source'],
  createBranch: ['branchName'],
  switchBranch: ['branchName'],
  createBranchAt: ['branchName', 'startPoint'],
  createTag: ['tagName'],
  pushTags: ['remoteName'],
  createProject: ['procedure'],
  createSubdataset: ['procedure'],
  disconnectRemote: ['remoteName']
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

  // Text fields must be text: spawn() turns an array into a string, and the main process compares strings.
  for (const field of [...schema.required, ...schema.optional]) {
    const value = request[field]
    if (field === 'paths' || value === undefined || value === null) {
      continue
    }
    if (field === 'force' ? typeof value !== 'boolean' : typeof value !== 'string') {
      throw new Error(`Invalid request for ${commandName}: ${field} must be ${field === 'force' ? 'a boolean' : 'a string'}`)
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

  if (commandName === 'cloneInstall' && /^\s*ext::/i.test(request.source)) {
    throw new Error('Invalid request for cloneInstall: the ext:: transport is not allowed')
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
