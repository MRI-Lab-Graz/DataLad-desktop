import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { formatEnvironmentDiagnostics } from './diagnostics.js'
import { mapCommandError } from './errors.js'
import { ProcessRunner } from './process-runner.js'
import { parseGitStatusPorcelain } from './status.js'
import {
  assertCommandRequest,
  buildCommandResult,
  getAdapterInterfaceContract
} from './schema.js'

const CURATED_COMMANDS = new Set([
  'cloneInstall',
  'createProject',
  'get',
  'save',
  'update',
  'push',
  'createBranch',
  'switchBranch'
])
const NO_DATASET_PATTERN = /(nodatasetfound|not a dataset|no dataset found|could not find dataset)/i
const NO_COMMITS_PATTERN = /(does not have any commits yet|has no commits yet)/i

export class DataLadAdapter {
  constructor({ runner } = {}) {
    this.runner = runner ?? new ProcessRunner()
  }

  async checkEnvironment() {
    const [python, datalad, gitAnnex] = await Promise.all([
      this.#checkPython(),
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
    const warnings = this.#extractCommandWarnings(commandName, result)

    if (!result.failed) {
      return buildCommandResult(commandName, result, null, warnings)
    }

    return buildCommandResult(commandName, result, mapCommandError(commandName, result), warnings)
  }

  async listDatasets(projectPath) {
    await this.#ensureGitProject(projectPath)

    const datasets = [{
      path: projectPath,
      relativePath: '.',
      kind: 'root'
    }]

    const subdatasetPaths = await this.#readSubdatasetPathsFromGitModules(projectPath)
    for (const relativePath of subdatasetPaths) {
      datasets.push({
        path: join(projectPath, relativePath),
        relativePath,
        kind: 'subdataset'
      })
    }

    return datasets
  }

  async readGitignore(projectPath, relativeDatasetPath = '.') {
    await this.#ensureGitProject(projectPath)

    const datasetPath = this.#resolveDatasetPath(projectPath, relativeDatasetPath)
    const gitignorePath = join(datasetPath, '.gitignore')
    const exists = await fileExists(gitignorePath)

    return {
      relativeDatasetPath,
      content: exists ? await readFile(gitignorePath, 'utf8') : '',
      exists
    }
  }

  async addIgnorePatterns(projectPath, relativeDatasetPaths, patterns) {
    await this.#ensureGitProject(projectPath)

    const cleanPatterns = [...new Set((patterns ?? []).map((pattern) => pattern.trim()).filter(Boolean))]
    const targetPaths = [...new Set(relativeDatasetPaths ?? [])]

    const results = []
    for (const relativeDatasetPath of targetPaths) {
      results.push(await this.#addIgnorePatternsToDataset(projectPath, relativeDatasetPath, cleanPatterns))
    }

    return results
  }

  async #addIgnorePatternsToDataset(projectPath, relativeDatasetPath, cleanPatterns) {
    const datasetPath = this.#resolveDatasetPath(projectPath, relativeDatasetPath)
    const gitignorePath = join(datasetPath, '.gitignore')
    const exists = await fileExists(gitignorePath)
    const existingContent = exists ? await readFile(gitignorePath, 'utf8') : ''
    const existingLines = new Set(
      existingContent
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    )

    const addedPatterns = cleanPatterns.filter((pattern) => !existingLines.has(pattern))
    if (addedPatterns.length === 0) {
      return { relativeDatasetPath, addedPatterns: [], content: existingContent }
    }

    const prefix = existingContent.length === 0 || existingContent.endsWith('\n') ? existingContent : `${existingContent}\n`
    const nextContent = `${prefix}${addedPatterns.join('\n')}\n`
    await writeFile(gitignorePath, nextContent, 'utf8')

    return { relativeDatasetPath, addedPatterns, content: nextContent }
  }

  #resolveDatasetPath(projectPath, relativeDatasetPath) {
    return relativeDatasetPath === '.' ? projectPath : join(projectPath, relativeDatasetPath)
  }

  async listBranches(projectPath) {
    await this.#ensureGitProject(projectPath)

    const branchResult = await this.runner.run('git', [
      '-C',
      projectPath,
      'branch',
      '--format=%(refname:short)'
    ])

    if (branchResult.failed) {
      throw new Error(
        `Could not list branches for project: ${projectPath} (${branchResult.stderr.trim() || 'unknown error'})`
      )
    }

    const currentBranchResult = await this.runner.run('git', ['-C', projectPath, 'branch', '--show-current'])
    const branches = (branchResult.stdout ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right))

    const currentBranch = this.#firstLine(currentBranchResult.stdout)

    return {
      projectPath,
      currentBranch,
      detachedHead: !currentBranch,
      branches
    }
  }

  async getLastCommit(projectPath) {
    try {
      await this.#ensureGitProject(projectPath)
    } catch {
      return {
        hasCommit: false,
        reason: 'not-git'
      }
    }

    const result = await this.runner.run('git', [
      '-C',
      projectPath,
      'log',
      '-1',
      '--format=%ct%x00%h%x00%s%x00%B'
    ])

    if (result.failed) {
      const diagnostics = `${result.stderr ?? ''}\n${result.stdout ?? ''}`
      if (NO_COMMITS_PATTERN.test(diagnostics)) {
        return {
          hasCommit: false,
          reason: 'no-commits'
        }
      }

      return {
        hasCommit: false,
        reason: 'unavailable'
      }
    }

    const [timestampLine, commitHashLine, subjectLine, ...messageParts] = (result.stdout ?? '').split('\u0000')
    const timestamp = Number.parseInt(timestampLine, 10)

    if (!Number.isFinite(timestamp)) {
      return {
        hasCommit: false,
        reason: 'unavailable'
      }
    }

    return {
      hasCommit: true,
      timestamp,
      commitHash: (commitHashLine ?? '').trim(),
      subject: (subjectLine ?? '').trim(),
      message: messageParts.join('\u0000').trim()
    }
  }

  async getWorkingTreeStatus(projectPath) {
    await this.#ensureGitProject(projectPath)

    const parsed = await this.#readGitStatus(projectPath)
    const subdatasetPaths = new Set(await this.#readSubdatasetPathsFromGitModules(projectPath))

    const files = await Promise.all(
      parsed.files.map(async (file) => {
        if (!subdatasetPaths.has(file.path)) {
          return file
        }

        return {
          ...file,
          isSubmodule: true,
          nestedFiles: await this.#collectSubmoduleStatus(projectPath, file.path)
        }
      })
    )

    return {
      projectPath,
      ...parsed,
      files
    }
  }

  async #readGitStatus(projectPath) {
    const result = await this.runner.run('git', [
      '-C',
      projectPath,
      '-c',
      'core.quotePath=false',
      'status',
      '--porcelain',
      '--untracked-files=all'
    ])

    if (result.failed) {
      throw new Error(
        `Could not read working tree status for project: ${projectPath} (${result.stderr.trim() || 'unknown error'})`
      )
    }

    return parseGitStatusPorcelain(result.stdout ?? '')
  }

  async #collectSubmoduleStatus(projectPath, relativeSubdatasetPath) {
    const submodulePath = join(projectPath, relativeSubdatasetPath)
    const result = await this.runner.run('git', [
      '-C',
      submodulePath,
      '-c',
      'core.quotePath=false',
      'status',
      '--porcelain',
      '--untracked-files=all'
    ])

    if (result.failed) {
      return []
    }

    const parsed = parseGitStatusPorcelain(result.stdout ?? '')
    const nestedSubdatasetPaths = new Set(await this.#readSubdatasetPathsFromGitModules(submodulePath))

    return Promise.all(
      parsed.files.map(async (file) => {
        const combinedPath = `${relativeSubdatasetPath}/${file.path}`

        if (!nestedSubdatasetPaths.has(file.path)) {
          return { ...file, path: combinedPath }
        }

        return {
          ...file,
          path: combinedPath,
          isSubmodule: true,
          nestedFiles: await this.#collectSubmoduleStatus(projectPath, combinedPath)
        }
      })
    )
  }

  async listRecentCommits(projectPath, options = {}) {
    await this.#ensureGitProject(projectPath)

    const requestedLimit = Number.parseInt(options.limit, 10)
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 100)
      : 20

    const result = await this.runner.run('git', [
      '-C',
      projectPath,
      'log',
      '-n',
      String(limit),
      '--format=%ct%x00%h%x00%an%x00%s'
    ])

    if (result.failed) {
      const diagnostics = `${result.stderr ?? ''}\n${result.stdout ?? ''}`
      if (NO_COMMITS_PATTERN.test(diagnostics)) {
        return {
          projectPath,
          commits: []
        }
      }

      throw new Error(
        `Could not list recent commits for project: ${projectPath} (${result.stderr.trim() || 'unknown error'})`
      )
    }

    const commits = []
    for (const line of (result.stdout ?? '').split(/\r?\n/)) {
      if (!line.trim()) {
        continue
      }

      const [timestampRaw, commitHash, author, subject] = line.split('\u0000')
      const timestamp = Number.parseInt(timestampRaw, 10)
      if (!Number.isFinite(timestamp)) {
        continue
      }

      commits.push({
        timestamp,
        commitHash: (commitHash ?? '').trim(),
        author: (author ?? '').trim(),
        subject: (subject ?? '').trim()
      })
    }

    return {
      projectPath,
      commits
    }
  }

  async getProjectHealth(projectPath) {
    await this.#ensureGitProject(projectPath)

    const [sync, missingContent] = await Promise.all([
      this.#readSyncStatus(projectPath),
      this.#readMissingContentStatus(projectPath)
    ])

    return {
      projectPath,
      ...sync,
      ...missingContent
    }
  }

  getInterfaceContract() {
    return getAdapterInterfaceContract()
  }

  async #checkPython() {
    const attemptedDetails = []

    for (const candidate of this.#pythonCandidates()) {
      const result = await this.runner.run(candidate.command, candidate.args)

      if (result.failed) {
        const details = (result.stderr || result.stdout || '').trim()
        if (details) {
          attemptedDetails.push(`${candidate.label}: ${details}`)
        }
        continue
      }

      const versionLine = this.#firstLine(result.stdout || result.stderr)
      if (versionLine && /^Python\s+3(\D|$)/i.test(versionLine)) {
        return {
          available: true,
          version: versionLine,
          details: null
        }
      }

      attemptedDetails.push(
        `${candidate.label}: ${versionLine || 'returned an unknown version string'}`
      )
    }

    return {
      available: false,
      version: null,
      details:
        attemptedDetails.join(' | ') || 'No supported Python 3 command was found in PATH.'
    }
  }

  #pythonCandidates() {
    const candidates = [
      {
        command: 'python3',
        args: ['--version'],
        label: 'python3 --version'
      },
      {
        command: 'python',
        args: ['--version'],
        label: 'python --version'
      }
    ]

    if (process.platform === 'win32') {
      candidates.unshift({
        command: 'py',
        args: ['-3', '--version'],
        label: 'py -3 --version'
      })
    }

    return candidates
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

  async #readSyncStatus(projectPath) {
    const upstreamResult = await this.runner.run('git', [
      '-C',
      projectPath,
      'rev-parse',
      '--abbrev-ref',
      '--symbolic-full-name',
      '@{u}'
    ])

    if (upstreamResult.failed) {
      return { hasUpstream: false, upstream: null, ahead: null, behind: null }
    }

    const upstream = this.#firstLine(upstreamResult.stdout)
    const countResult = await this.runner.run('git', [
      '-C',
      projectPath,
      'rev-list',
      '--left-right',
      '--count',
      `${upstream}...HEAD`
    ])

    if (countResult.failed) {
      return { hasUpstream: true, upstream, ahead: null, behind: null }
    }

    const [behindRaw, aheadRaw] = (countResult.stdout ?? '').trim().split(/\s+/)
    const behind = Number.parseInt(behindRaw, 10)
    const ahead = Number.parseInt(aheadRaw, 10)

    return {
      hasUpstream: true,
      upstream,
      ahead: Number.isFinite(ahead) ? ahead : null,
      behind: Number.isFinite(behind) ? behind : null
    }
  }

  async #readMissingContentStatus(projectPath) {
    const result = await this.runner.run('git', ['-C', projectPath, 'annex', 'find', '--not', '--in', 'here'])

    if (result.failed) {
      return { annexSupported: false, missingContentCount: null }
    }

    const missingPaths = (result.stdout ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    return { annexSupported: true, missingContentCount: missingPaths.length }
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

  async #readSubdatasetPathsFromGitModules(projectPath) {
    const gitModulesPath = join(projectPath, '.gitmodules')
    if (!(await fileExists(gitModulesPath))) {
      return []
    }

    const content = await readFile(gitModulesPath, 'utf8')
    const subdatasetPaths = []
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*path\s*=\s*(.+)\s*$/)
      if (match && match[1]) {
        subdatasetPaths.push(match[1].trim())
      }
    }

    return [...new Set(subdatasetPaths)]
  }

  #extractCommandWarnings(commandName, runResult) {
    const stderr = runResult.stderr ?? ''
    if (!stderr.trim()) {
      return []
    }

    const warnings = []

    if (/remote origin not usable by git-annex/i.test(stderr)) {
      warnings.push({
        code: 'ORIGIN_NOT_ANNEX_REMOTE',
        severity: 'info',
        message:
          'The origin remote is usable for Git metadata but does not provide git-annex content endpoints.'
      })
    }

    if (/\/config\s+download failed:\s*Not Found/i.test(stderr)) {
      warnings.push({
        code: 'REMOTE_CONFIG_NOT_FOUND',
        severity: 'info',
        message:
          'A remote git-annex config endpoint was not found. Dataset metadata clone can still succeed.'
      })
    }

    const siblingMatch = stderr.match(/access to \d+ dataset sibling\s+([^\s]+)\s+not auto-enabled/i)
    if (siblingMatch) {
      const siblingName = siblingMatch[1]
      warnings.push({
        code: 'SIBLING_NOT_AUTO_ENABLED',
        severity: 'info',
        message: `Sibling ${siblingName} was discovered but not auto-enabled. Enable it if you need data from that source.`,
        actionHint: `datalad siblings -d "<dataset-path>" enable -s ${siblingName}`
      })
    }

    if (warnings.length === 0 && commandName === 'cloneInstall') {
      warnings.push({
        code: 'CLONE_STDERR_OUTPUT',
        severity: 'info',
        message: 'Clone completed with additional command output in stderr. Review details if needed.'
      })
    }

    return warnings
  }

  #buildCommand(commandName, request) {
    switch (commandName) {
      case 'cloneInstall': {
        return {
          command: 'datalad',
          args: ['clone', '--', request.source, request.targetPath],
          options: {}
        }
      }
      case 'createProject': {
        return {
          command: 'datalad',
          args: ['create', '--', request.targetPath],
          options: {}
        }
      }
      case 'get': {
        const projectPath = request.projectPath
        const paths = request.paths ?? []
        return {
          command: 'datalad',
          args: paths.length > 0 ? ['-C', projectPath, 'get', '--', ...paths] : ['-C', projectPath, 'get'],
          options: { cwd: projectPath }
        }
      }
      case 'save': {
        const projectPath = request.projectPath
        const message = request.message
        const paths = request.paths ?? []
        return {
          command: 'datalad',
          args: paths.length > 0
            ? ['-C', projectPath, 'save', '-m', message, '--', ...paths]
            : ['-C', projectPath, 'save', '-m', message],
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
      case 'createBranch': {
        const projectPath = request.projectPath
        const branchName = request.branchName
        return {
          command: 'git',
          args: ['-C', projectPath, 'checkout', '-b', branchName],
          options: { cwd: projectPath }
        }
      }
      case 'switchBranch': {
        const projectPath = request.projectPath
        const branchName = request.branchName
        return {
          command: 'git',
          args: ['-C', projectPath, 'checkout', branchName],
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