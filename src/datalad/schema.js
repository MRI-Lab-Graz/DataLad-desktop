export const ADAPTER_INTERFACE_VERSION = '0.2.0'

export const COMMAND_SCHEMAS = Object.freeze({
  cloneInstall: {
    required: ['source', 'targetPath'],
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
  }
})

const RESULT_BASE_FIELDS = ['command', 'args', 'exitCode', 'stdout', 'stderr', 'failed']

/**
 * @typedef {'cloneInstall' | 'get' | 'save' | 'update' | 'push'} DataLadCommandName
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
}

export function assertRunnerResultShape(result) {
  for (const field of RESULT_BASE_FIELDS) {
    if (!Object.hasOwn(result, field)) {
      throw new Error(`Runner result is missing field: ${field}`)
    }
  }
}

export function buildCommandResult(commandName, runResult, userError = null) {
  assertRunnerResultShape(runResult)
  return {
    ok: !runResult.failed,
    commandName,
    ...runResult,
    userError
  }
}

export function getAdapterInterfaceContract() {
  return {
    version: ADAPTER_INTERFACE_VERSION,
    classificationValues: ['git', 'dataset', 'superdataset'],
    commands: COMMAND_SCHEMAS
  }
}