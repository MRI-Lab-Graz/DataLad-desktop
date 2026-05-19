import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { formatEnvironmentDiagnostics } from './diagnostics.js'
import { mapCommandError } from './errors.js'
import { ProcessRunner } from './process-runner.js'
import {
  assertCommandRequest,
  buildCommandResult,
  getAdapterInterfaceContract
} from './schema.js'

const CURATED_COMMANDS = new Set(['cloneInstall', 'get', 'save', 'update', 'push'])
const NO_DATASET_PATTERN = /(nodatasetfound|not a dataset|no dataset found|could not find dataset)/i

export class DataLadAdapter {
  constructor({ runner } = {}) {
    this.runner = runner ?? new ProcessRunner()
  }

  async checkEnvironment() {
    const [python, datalad, gitAnnex] = await Promise.all([
      this.#checkTool('python3', ['--version']),
      this.#checkTool('datalad', ['--version']),
      this.#checkTool('git', ['annex', 'version'])
    ])

    const issues = []

    if (!python.available) {
      issues.push({
        code: 'PYTHON_MISSING',
        message: 'Python 3 is required but not available.'
      })
    }

    if (!datalad.available) {
      issues.push({
        code: 'DATALAD_MISSING',
        message: 'DataLad is not available in PATH.'
      })
    }

    if (!gitAnnex.available) {
      issues.push({
        code: 'GIT_ANNEX_MISSING',
        message: 'git-annex support is not available.'
      })
    }

    const diagnostics = {
      python,
      datalad,
      gitAnnex,
      supported: issues.length === 0,
      issues
    }

    return {
      ...diagnostics,
      report: formatEnvironmentDiagnostics(diagnostics)
    }
  }

  async detectProject(projectPath) {
    await this.#ensureGitProject(projectPath)

    const hasDataladConfig = await fileExists(join(projectPath, '.datalad', 'config'))
    const datasetProbe = await this.#probeDataLadDataset(projectPath)

    const isDataset =
      datasetProbe.isDataset !== null ? datasetProbe.isDataset : hasDataladConfig

    if (!isDataset) {
      return {
        projectPath,
        classification: 'git',
        reason:
          datasetProbe.reason ??
          (hasDataladConfig
            ? 'DataLad metadata probe failed and no supported fallback confirmed dataset state.'
            : 'DataLad probe did not detect a dataset.')
      }
    }

    const subdatasetProbe = await this.#probeSubdatasets(projectPath)
    const hasSubdatasets =
      subdatasetProbe.hasSubdatasets !== null
        ? subdatasetProbe.hasSubdatasets
        : await this.#hasRegisteredSubdatasets(projectPath)

    return {
      projectPath,
      classification: hasSubdatasets ? 'superdataset' : 'dataset',
      reason: hasSubdatasets
        ? subdatasetProbe.reason ?? 'DataLad subdataset probe detected child datasets.'
        : datasetProbe.reason ?? 'DataLad dataset detected with no child datasets.',
      classificationSource: {
        dataset: datasetProbe.source,
        subdatasets: subdatasetProbe.source
      }
    }
  }

  async runCommand(commandName, request = {}) {
    if (!CURATED_COMMANDS.has(commandName)) {
      throw new Error(`Unsupported command: ${commandName}`)
    }

    assertCommandRequest(commandName, request)

    const commandSpec = this.#buildCommand(commandName, request)
    const result = await this.runner.run(commandSpec.command, commandSpec.args, commandSpec.options)

    if (!result.failed) {
      return buildCommandResult(commandName, result)
    }

    return buildCommandResult(commandName, result, mapCommandError(commandName, result))
  }

  getInterfaceContract() {
    return getAdapterInterfaceContract()
  }

  async #checkTool(command, args) {
    const result = await this.runner.run(command, args)
    if (result.failed) {
      return {
        available: false,
        version: null,
        details: result.stderr.trim() || result.stdout.trim()
      }
    }

    return {
      available: true,
      version: this.#firstLine(result.stdout || result.stderr),
      details: null
    }
  }

  #firstLine(text) {
    return (text ?? '').split(/\r?\n/, 1)[0].trim() || null
  }

  async #ensureGitProject(projectPath) {
    const result = await this.runner.run('git', ['-C', projectPath, 'rev-parse', '--is-inside-work-tree'])
    if (result.failed) {
      throw new Error(`Path is not a git repository: ${projectPath}`)
    }
  }

  async #probeDataLadDataset(projectPath) {
    const result = await this.runner.run('datalad', ['-C', projectPath, 'status', '--dataset', '.', '--json'])

    if (!result.failed) {
      return {
        isDataset: true,
        source: 'datalad-status-probe',
        reason: 'DataLad status probe succeeded.'
      }
    }

    if (NO_DATASET_PATTERN.test(result.stderr ?? '')) {
      return {
        isDataset: false,
        source: 'datalad-status-probe',
        reason: 'DataLad status reported that this repository is not a dataset.'
      }
    }

    return {
      isDataset: null,
      source: 'metadata-fallback',
      reason: null
    }
  }

  async #probeSubdatasets(projectPath) {
    const result = await this.runner.run('datalad', [
      '-C',
      projectPath,
      'subdatasets',
      '--result-renderer',
      'disabled'
    ])

    if (result.failed) {
      return {
        hasSubdatasets: null,
        source: 'metadata-fallback',
        reason: null
      }
    }

    const hasSubdatasets = (result.stdout ?? '').trim().length > 0
    return {
      hasSubdatasets,
      source: 'datalad-subdatasets-probe',
      reason: hasSubdatasets
        ? 'DataLad subdatasets probe found at least one child dataset.'
        : 'DataLad subdatasets probe found no child datasets.'
    }
  }

  async #hasRegisteredSubdatasets(projectPath) {
    const gitModulesPath = join(projectPath, '.gitmodules')
    if (!(await fileExists(gitModulesPath))) {
      return false
    }

    const content = await readFile(gitModulesPath, 'utf8')
    return /\[submodule\s+".+"\]/.test(content)
  }

  #buildCommand(commandName, request) {
    switch (commandName) {
      case 'cloneInstall': {
        return {
          command: 'datalad',
          args: ['clone', request.source, request.targetPath],
          options: {}
        }
      }
      case 'get': {
        const projectPath = request.projectPath
        const paths = request.paths ?? []
        return {
          command: 'datalad',
          args: ['-C', projectPath, 'get', ...paths],
          options: { cwd: projectPath }
        }
      }
      case 'save': {
        const projectPath = request.projectPath
        const message = request.message
        const paths = request.paths ?? []
        return {
          command: 'datalad',
          args: ['-C', projectPath, 'save', '-m', message, ...paths],
          options: { cwd: projectPath }
        }
      }
      case 'update': {
        const projectPath = request.projectPath
        return {
          command: 'datalad',
          args: ['-C', projectPath, 'update', '--merge'],
          options: { cwd: projectPath }
        }
      }
      case 'push': {
        const projectPath = request.projectPath
        return {
          command: 'datalad',
          args: ['-C', projectPath, 'push'],
          options: { cwd: projectPath }
        }
      }
      default:
        throw new Error(`Unsupported command: ${commandName}`)
    }
  }
}

async function fileExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export function createDataLadAdapter(options) {
  return new DataLadAdapter(options)
}