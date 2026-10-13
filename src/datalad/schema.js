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
    required: ['projectPath', 'remoteName', 'tagNames'],
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
    optional: ['remoteName']
  },
  addRemote: {
    required: ['projectPath', 'remoteName', 'url'],
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
  merge: {
    required: ['projectPath', 'branchName'],
    optional: []
  },
  finishMerge: {
    required: ['projectPath'],
    optional: []
  },
  abortMerge: {
    required: ['projectPath'],
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
  },
  run: {
    required: ['projectPath', 'message', 'command'],
    optional: ['inputs', 'outputs']
  }
})

const RESULT_BASE_FIELDS = ['command', 'args', 'exitCode', 'stdout', 'stderr', 'failed']
const LEADING_DASH_FIELDS = Object.freeze({
  cloneInstall: ['source'],
  createBranch: ['branchName'],
  switchBranch: ['branchName'],
  createBranchAt: ['branchName', 'startPoint'],
  merge: ['branchName'],
  createTag: ['tagName'],
  pushTags: ['remoteName'],
  addRemote: ['remoteName', 'url'],
  push: ['remoteName'],
  createProject: ['procedure'],
  createSubdataset: ['procedure'],
  disconnectRemote: ['remoteName'],
  run: ['message', 'command']
})

/**
 * @typedef {'cloneInstall' | 'get' | 'save' | 'update' | 'push' | 'createBranch' | 'switchBranch'} DataLadCommandName
 */

const RUN_MAX_COMMAND_LENGTH = 10_000
const RUN_MAX_PATHS = 200

// Paths DataLad is told about: relative, inside the project (DataLad itself accepts "../x" silently).
function isProjectRelativePath(value) {
  return !value.includes('\0') && !/^([A-Za-z]:|[\\/])/.test(value) && !value.split(/[\\/]/).includes('..')
}

// Nothing that can hide or disguise text in the native confirmation: control characters (except line feed and tab),
// bidirectional overrides and isolates, zero-width characters, the byte-order mark.
const RUN_HIDDEN_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/
const RUN_MAX_LINES = 20

function assertRunRequest(request, platform) {
  if (request.command.trim() === '') {
    throw new Error('Invalid request for run: command must not be empty')
  }
  if (request.command.includes('\0')) {
    throw new Error('Invalid request for run: command must not contain a NUL character')
  }
  if (RUN_HIDDEN_CHARACTERS.test(request.command)) {
    throw new Error('Invalid request for run: command must not contain control or hidden characters')
  }
  if (request.command.trim().split('\n').length > RUN_MAX_LINES) {
    throw new Error(`Invalid request for run: command must have at most ${RUN_MAX_LINES} lines`)
  }
  if (platform === 'win32' && request.command.trim().includes('\n')) {
    throw new Error('Invalid request for run: command must be one line on Windows (cmd.exe stops at the first line break)')
  }
  if (request.command.length > RUN_MAX_COMMAND_LENGTH) {
    throw new Error(`Invalid request for run: command is too long (at most ${RUN_MAX_COMMAND_LENGTH} characters)`)
  }
  for (const field of ['inputs', 'outputs']) {
    const values = request[field]
    if (values === undefined) {
      continue
    }
    if (!Array.isArray(values)) {
      throw new Error(`Invalid request for run: ${field} must be an array`)
    }
    if (values.length > RUN_MAX_PATHS) {
      throw new Error(`Invalid request for run: at most ${RUN_MAX_PATHS} ${field}`)
    }
    for (const value of values) {
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`Invalid request for run: each ${field} entry must be a non-empty string`)
      }
      if (!isProjectRelativePath(value)) {
        throw new Error(`Invalid request for run: ${field} must be paths inside the project`)
      }
    }
  }
}

export function assertCommandRequest(commandName, request, { platform = process.platform } = {}) {
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
    if (field === 'paths' || field === 'tagNames' || field === 'inputs' || field === 'outputs' || value === undefined || value === null) {
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

  // Stored in plain text in .git/config and shown on screen: the credential helper is the place for secrets.
  if (commandName === 'addRemote' && /^\s*(https?|ftps?):\/\/[^/@\s]+@/i.test(request.url)) {
    throw new Error('Invalid request for addRemote: the URL must not contain a password or token; use your credential helper')
  }

  const transportField = { cloneInstall: 'source', addRemote: 'url' }[commandName]
  if (transportField && /^\s*ext::/i.test(request[transportField])) {
    throw new Error(`Invalid request for ${commandName}: the ext:: transport is not allowed`)
  }

  if (commandName === 'pushTags') {
    if (!Array.isArray(request.tagNames) || request.tagNames.length === 0 || request.tagNames.some((n) => typeof n !== 'string')) {
      throw new Error('Invalid request for pushTags: tagNames must be a non-empty array of strings')
    }
  }

  if (commandName === 'run') {
    assertRunRequest(request, platform)
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
