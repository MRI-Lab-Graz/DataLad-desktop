import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
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
  'createSubdataset',
  'get',
  'save',
  'update',
  'push',
  'disconnectRemote',
  'createSibling',
  'createBranch',
  'switchBranch',
  'createBranchAt',
  'restoreFileFromCommit',
  'discardChanges',
  'unlock'
])
const COMMIT_HASH_PATTERN = /^[0-9a-f]{4,64}$/i
const BIDS_MARKER_FILE = 'dataset_description.json'
const BIDS_SUBJECT_DIR_PATTERN = /^sub-[A-Za-z0-9._-]+$/
// Top-level BIDS folder names nested/detected alongside sub-* subject dirs.
const BIDS_TOP_LEVEL_DIR_NAMES = ['rawdata', 'derivatives', 'sourcedata']
// Written to each dataset's .git/info/exclude (untracked, local-only) rather
// than the shared .gitignore — these are artifacts of the researcher's own
// OS, not something to commit and push to collaborators/the studies server.
const OS_NOISE_PATTERNS = ['.DS_Store', '._*', 'Thumbs.db', 'desktop.ini']
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
    const { isBids, bidsReason } = await this.#probeBidsMarker(projectPath)

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
            : 'DataLad probe did not detect a dataset.'),
        isBids,
        bidsReason
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
      },
      isBids,
      bidsReason
    }
  }

  // The BIDS spec's own root marker file — used as-is rather than inventing
  // app-specific config, since it's already what publishers/tools rely on.
  async #probeBidsMarker(projectPath) {
    const isBids = await fileExists(join(projectPath, BIDS_MARKER_FILE))
    return {
      isBids,
      bidsReason: isBids ? `Found ${BIDS_MARKER_FILE} at the project root (BIDS root marker).` : null
    }
  }

  // Lightweight, git-agnostic probe for the Create Project flow: the target
  // folder isn't a repo yet at this point, so detectProject (which requires
  // one) doesn't apply. Never throws — an unreadable/nonexistent folder is
  // just "not BIDS-like", not an error worth surfacing here.
  async inspectBidsCandidate(folderPath) {
    let entries
    try {
      entries = await readdir(folderPath, { withFileTypes: true })
    } catch {
      return { folderPath, bidsLikely: false, confidence: 'none', signals: [], candidateSubpaths: [] }
    }

    const names = new Set(entries.map((entry) => entry.name))
    const signals = []
    if (names.has(BIDS_MARKER_FILE)) signals.push(BIDS_MARKER_FILE)
    if (names.has('participants.tsv')) signals.push('participants.tsv')
    if (names.has('participants.json')) signals.push('participants.json')
    const presentTopLevelDirs = BIDS_TOP_LEVEL_DIR_NAMES.filter((name) => names.has(name))
    for (const name of presentTopLevelDirs) signals.push(`${name}/`)

    const subjectDirs = entries
      .filter((entry) => entry.isDirectory() && BIDS_SUBJECT_DIR_PATTERN.test(entry.name))
      .map((entry) => entry.name)
    if (subjectDirs.length > 0) signals.push(`${subjectDirs.length} sub-* folder(s)`)

    const confidence = names.has(BIDS_MARKER_FILE) ? 'high' : signals.length > 0 ? 'medium' : 'none'
    const candidateSubpaths = [...subjectDirs, ...presentTopLevelDirs]

    return { folderPath, bidsLikely: confidence !== 'none', confidence, signals, candidateSubpaths }
  }

  // Writes the BIDS root marker file if one isn't already present — needed
  // so a freshly-scaffolded (not adopted) BIDS project is actually
  // recognizable as BIDS afterward, since detectProject's isBids check has
  // nothing else to go on for a project that never had this file to begin
  // with. Idempotent: never overwrites an existing marker (e.g. one already
  // brought in by an adopted folder).
  async ensureBidsMarker(projectPath, metadata = {}) {
    const markerPath = join(projectPath, BIDS_MARKER_FILE)
    if (await fileExists(markerPath)) {
      return { created: false, markerPath }
    }

    const name = metadata.name?.trim() || basename(projectPath)
    const content = `${JSON.stringify({ Name: name, BIDSVersion: '1.8.0' }, null, 2)}\n`
    await writeFile(markerPath, content, 'utf8')
    return { created: true, markerPath }
  }

  // Unlike inspectBidsCandidate (a pre-git folder probe), this runs against
  // an already-existing project — used to find BIDS-like top-level folders
  // that exist on disk but aren't yet registered as subdatasets, whether
  // that's because they came in flat from a remote clone, were already
  // sitting there when the project was opened, or are new since the last
  // check. Self-limiting: once everything is nested this returns [], so
  // calling it on every project open/detect is naturally a no-op.
  async findUnnestedBidsCandidates(projectPath) {
    const registered = new Set(await this.#readSubdatasetPathsFromGitModules(projectPath))

    let entries
    try {
      entries = await readdir(projectPath, { withFileTypes: true })
    } catch {
      return []
    }

    return entries
      .filter((entry) => entry.isDirectory() && !registered.has(entry.name))
      .filter((entry) => BIDS_SUBJECT_DIR_PATTERN.test(entry.name) || BIDS_TOP_LEVEL_DIR_NAMES.includes(entry.name))
      .map((entry) => entry.name)
  }

  // Idempotent pre-step for nesting a folder that may already be tracked in
  // the parent's history (a flat remote clone, or a pre-existing project
  // opened from disk) — as opposed to the loose-untracked-files case, where
  // there's nothing to untrack. --cached only touches git's index, never
  // the working tree, so this never risks losing file content (or annex
  // symlinks, fetched or not).
  //
  // The removal has to be committed, not just staged: `datalad create
  // --force` refuses with a "collision with content in parent dataset"
  // error if the path is still present in the parent's *committed* tree,
  // even once `git rm --cached` has staged its removal — verified directly
  // against real DataLad 1.6 behavior.
  //
  // The commit deliberately has NO pathspec: `git commit -- <pathspec>`
  // re-stages that pathspec's current *working-tree* content before
  // comparing to HEAD (effectively an implicit `git add`), which undoes the
  // --cached removal above since the files are still physically present —
  // verified directly, it reports "nothing to commit" and leaves the
  // removal uncommitted. A plain `git commit` just commits whatever is
  // currently staged, which is exactly (and only) this removal.
  async untrackPath(projectPath, relativePath) {
    if (!isSafeRelativeSubdatasetPath(relativePath)) {
      throw new Error(`Invalid path: ${relativePath}`)
    }

    const tracked = await this.runner.run('git', ['-C', projectPath, 'ls-files', '--', relativePath])
    if (!tracked.stdout.trim()) {
      return { removed: false }
    }

    const rmResult = await this.runner.run('git', ['-C', projectPath, 'rm', '-r', '--cached', '--', relativePath])
    if (rmResult.failed) {
      throw new Error(`Could not untrack ${relativePath}: ${rmResult.stderr || rmResult.stdout}`)
    }

    const commitResult = await this.runner.run('git', [
      '-C', projectPath, 'commit', '-m', `Untrack ${relativePath} for subdataset conversion`
    ])
    if (commitResult.failed) {
      throw new Error(`Could not commit untracking of ${relativePath}: ${commitResult.stderr || commitResult.stdout}`)
    }

    return { removed: true }
  }

  async runCommand(commandName, request = {}) {
    if (!CURATED_COMMANDS.has(commandName)) {
      throw new Error(`Unsupported command: ${commandName}`)
    }

    assertCommandRequest(commandName, request)

    const commandSpec = this.#buildCommand(commandName, request)
    let result = await this.runner.run(commandSpec.command, commandSpec.args, commandSpec.options)
    const warnings = this.#extractCommandWarnings(commandName, result)

    if (!result.failed) {
      return buildCommandResult(commandName, result, null, warnings)
    }

    return buildCommandResult(commandName, result, mapCommandError(commandName, result), warnings)
  }

  // Recovery action offered alongside the REPO_LOCKED error (errors.js):
  // removes the standard git index lock left behind by an interrupted
  // Save/Update/Publish so the user can retry without a manual terminal fix.
  async clearRepositoryLock(projectPath) {
    await this.#ensureGitProject(projectPath)

    const lockPath = join(projectPath, '.git', 'index.lock')
    const existed = await fileExists(lockPath)
    if (existed) {
      await rm(lockPath, { force: true })
    }

    return { ok: true, removed: existed, lockPath }
  }

  // Best-effort, called on every project open (see detectProjectType in
  // app.js) so OS noise files are ALWAYS excluded — not something the
  // researcher has to remember to click. .git/info/exclude rather than
  // .gitignore: it's untracked/local-only, takes effect immediately with no
  // Save/commit needed, and doesn't push a macOS-specific rule to
  // collaborators or the shared studies server via the tracked .gitignore.
  async ignoreOsNoiseFiles(projectPath) {
    let datasets
    try {
      datasets = await this.listDatasets(projectPath)
    } catch {
      return []
    }

    const results = []
    for (const dataset of datasets) {
      results.push(await this.#addOsNoiseExcludes(dataset.path))
    }
    return results
  }

  async #addOsNoiseExcludes(datasetPath) {
    const gitDirResult = await this.runner.run('git', ['-C', datasetPath, 'rev-parse', '--git-dir'])
    if (gitDirResult.failed) {
      return { datasetPath, added: false }
    }

    // A dataset installed as a real git submodule (gitlink) has its .git as a
    // file pointing elsewhere (e.g. "../.git/modules/name") — rev-parse
    // resolves that for us, returning an absolute path in that case and a
    // relative one (typically ".git") for an ordinary repo.
    const gitDir = this.#firstLine(gitDirResult.stdout)
    const excludeDir = isAbsolute(gitDir) ? gitDir : join(datasetPath, gitDir)
    const excludePath = join(excludeDir, 'info', 'exclude')

    let existingContent = ''
    try {
      existingContent = await readFile(excludePath, 'utf8')
    } catch {
      // No info/exclude yet — fine, we create one below.
    }

    const existingLines = new Set(existingContent.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
    const addedPatterns = OS_NOISE_PATTERNS.filter((pattern) => !existingLines.has(pattern))
    if (addedPatterns.length === 0) {
      return { datasetPath, added: false }
    }

    const prefix = existingContent.length === 0 || existingContent.endsWith('\n') ? existingContent : `${existingContent}\n`
    await mkdir(join(excludeDir, 'info'), { recursive: true })
    await writeFile(excludePath, `${prefix}${addedPatterns.join('\n')}\n`, 'utf8')
    return { datasetPath, added: true }
  }

  async listDatasets(projectPath) {
    await this.#ensureGitProject(projectPath)

    const datasets = [{
      path: projectPath,
      relativePath: '.',
      kind: 'root'
    }]

    await this.#collectSubdatasets(projectPath, projectPath, '', datasets)

    return datasets
  }

  async #collectSubdatasets(rootPath, currentPath, relativePrefix, datasets) {
    const subdatasetPaths = await this.#readSubdatasetPathsFromGitModules(currentPath)
    for (const relativePath of subdatasetPaths) {
      const combinedRelativePath = relativePrefix ? `${relativePrefix}/${relativePath}` : relativePath
      const combinedPath = join(rootPath, combinedRelativePath)
      datasets.push({
        path: combinedPath,
        relativePath: combinedRelativePath,
        kind: 'subdataset'
      })
      await this.#collectSubdatasets(rootPath, combinedPath, combinedRelativePath, datasets)
    }
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

  // Session-only: kept in ProcessRunner's memory, never persisted. Needed
  // when the studies server requires password (not key-based) SSH auth —
  // see ssh-askpass.sh/.cmd for how it reaches the ssh child process.
  setStudiesServerPassword(password) {
    this.runner.setSshPassword(password)
  }

  clearStudiesServerPassword() {
    this.runner.clearSshPassword()
  }

  hasStudiesServerPassword() {
    return this.runner.hasSshPassword()
  }

  // Read-only SSH directory listing, not a datalad/git mutation, so it
  // deliberately bypasses the CURATED_COMMANDS/runCommand allowlist (that gate
  // exists for commands that mutate a local project path).
  async listRemoteStudies(serverConfig) {
    const host = serverConfig?.host?.trim()
    const remotePath = serverConfig?.path?.trim()
    const serverType = serverConfig?.type === 'gitolite' ? 'gitolite' : 'ssh-directory'

    if (!host || !remotePath) {
      return { ok: false, studies: [], error: { code: 'SERVER_NOT_CONFIGURED', message: 'Studies server host and path are not configured yet.' } }
    }

    return serverType === 'gitolite'
      ? this.#listRemoteStudiesGitolite(host, remotePath)
      : this.#listRemoteStudiesSshDirectory(host, remotePath)
  }

  async #listRemoteStudiesSshDirectory(host, remotePath) {
    const result = await this.runner.run('ssh', [host, 'ls', '-1', '--', remotePath])

    if (result.failed) {
      return { ok: false, studies: [], error: { code: 'REMOTE_LIST_FAILED', message: result.stderr.trim() || 'Could not list studies on the server.' } }
    }

    const studies = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    return { ok: true, studies, error: null }
  }

  // Gitolite forces every SSH session into its own restricted dispatcher —
  // arbitrary shell commands (like `ls`) are rejected outright. `info` is
  // gitolite's own command; it lists exactly the repos the connecting SSH
  // key has access to, which is also strictly more useful than a directory
  // listing: guests only ever see what they're actually permitted to read.
  async #listRemoteStudiesGitolite(host, repoPrefix) {
    const result = await this.runner.run('ssh', [host, 'info'])

    if (result.failed) {
      return { ok: false, studies: [], error: { code: 'REMOTE_LIST_FAILED', message: result.stderr.trim() || 'Could not list studies on the server.' } }
    }

    const prefix = repoPrefix.endsWith('/') ? repoPrefix : `${repoPrefix}/`
    // A repo name gitolite actually created only ever contains what its own
    // wildcard rule allows in each path segment (letters/digits/._-) plus
    // "/" between segments — confirmed against a real deployment. A row
    // whose "name" still contains regex metacharacters (`[`, `]`, `+`, ...)
    // is the wildcard *rule* itself (e.g. "mri-lab/CREATOR/[a-zA-Z0-9._-]+"),
    // which `info` lists as one of the repos this key has access to even
    // though nothing has been created under it yet — not a real study.
    const REAL_REPO_NAME_PATTERN = /^[A-Za-z0-9._/-]+$/
    const studies = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      // Skip the greeting line ("hello <user>, this is git@host running
      // gitolite..."); every real repo line's last whitespace-separated
      // token is the repo name, preceded by its access-flag column(s).
      .filter((line) => !/^hello\b/i.test(line))
      .map((line) => line.split(/\s+/).pop())
      .filter((repoName) => repoName && repoName.startsWith(prefix))
      .map((repoName) => repoName.slice(prefix.length))
      .filter((repoName) => repoName && REAL_REPO_NAME_PATTERN.test(repoName))

    return { ok: true, studies, error: null }
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

  async getCommitDetails(projectPath, commitHash) {
    await this.#ensureGitProject(projectPath)

    if (!COMMIT_HASH_PATTERN.test(commitHash)) {
      throw new Error(`Invalid commit hash format: ${commitHash}`)
    }

    const [metaResult, statResult, nameResult] = await Promise.all([
      this.runner.run('git', [
        '-C', projectPath,
        'log', '-1',
        '--format=%ct%x00%H%x00%an%x00%s%x00%B',
        commitHash
      ]),
      this.runner.run('git', [
        '-C', projectPath,
        'diff-tree', '--no-commit-id', '-r', '--stat', '--root',
        commitHash
      ]),
      this.runner.run('git', [
        '-C', projectPath,
        'diff-tree', '--no-commit-id', '-r', '--name-only', '--root',
        commitHash
      ])
    ])

    if (metaResult.failed) {
      throw new Error(
        `Could not get commit details: ${metaResult.stderr.trim() || 'unknown error'}`
      )
    }

    const [timestampRaw, longHash, author, subject, ...bodyParts] =
      (metaResult.stdout ?? '').split('\u0000')
    const timestamp = Number.parseInt(timestampRaw, 10)

    const statLines = (statResult.stdout ?? '')
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter(Boolean)

    const changedFiles = (nameResult.stdout ?? '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)

    return {
      commitHash: (longHash ?? commitHash).trim(),
      timestamp: Number.isFinite(timestamp) ? timestamp : null,
      author: (author ?? '').trim(),
      subject: (subject ?? '').trim(),
      message: bodyParts.join('\u0000').trim(),
      stat: statLines.join('\n'),
      changedFiles
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
      return { hasUpstream: false, upstream: null, ahead: null, behind: null, remoteUrl: null }
    }

    const upstream = this.#firstLine(upstreamResult.stdout)
    const remoteName = upstream?.split('/')[0] ?? null
    const remoteUrl = remoteName ? await this.#readRemoteUrl(projectPath, remoteName) : null

    const countResult = await this.runner.run('git', [
      '-C',
      projectPath,
      'rev-list',
      '--left-right',
      '--count',
      `${upstream}...HEAD`
    ])

    if (countResult.failed) {
      return { hasUpstream: true, upstream, ahead: null, behind: null, remoteUrl }
    }

    const [behindRaw, aheadRaw] = (countResult.stdout ?? '').trim().split(/\s+/)
    const behind = Number.parseInt(behindRaw, 10)
    const ahead = Number.parseInt(aheadRaw, 10)

    return {
      hasUpstream: true,
      upstream,
      ahead: Number.isFinite(ahead) ? ahead : null,
      behind: Number.isFinite(behind) ? behind : null,
      remoteUrl
    }
  }

  async #readRemoteUrl(projectPath, remoteName) {
    const result = await this.runner.run('git', ['-C', projectPath, 'remote', 'get-url', remoteName])
    if (result.failed) {
      return null
    }

    return this.#firstLine(result.stdout)
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

    return [...new Set(subdatasetPaths)].filter(isSafeRelativeSubdatasetPath)
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
        siblingName,
        message: `Sibling ${siblingName} was discovered but not auto-enabled. Enable it if you need data from that source.`,
        actionHint: `datalad siblings -d "<dataset-path>" enable -s ${siblingName}`
      })
    }

    if (warnings.length === 0 && commandName === 'cloneInstall') {
      const meaningfulLines = stderr.split(/\r?\n/).filter((l) => l.trim() && !/^\[INFO\]/i.test(l.trim()))
      if (meaningfulLines.length > 0) {
        warnings.push({
          code: 'CLONE_STDERR_OUTPUT',
          severity: 'info',
          message: 'Clone completed with additional command output in stderr. Review details if needed.'
        })
      }
    }

    return warnings
  }

  #buildCommand(commandName, request) {
    switch (commandName) {
      case 'cloneInstall': {
        // `datalad clone` has no -r/--recursive flag; recursive subdataset
        // install requires the `install` command, which in turn requires
        // -s to take an explicit destination path (otherwise a bare
        // positional after the source is treated as a get target within
        // an already-resolved dataset, not as the clone destination).
        return {
          command: 'datalad',
          args: ['install', '-r', '-s', request.source, '--', request.targetPath],
          options: {}
        }
      }
      case 'createProject': {
        // `procedure`/`force` are JS-only extensions (see the comment on
        // BRIDGE_COMMAND_SCHEMAS.createProject in schema.js) — omitted, they
        // produce the exact same args as before this existed.
        const args = ['create']
        if (request.procedure) {
          args.push('-c', request.procedure)
        }
        if (request.force) {
          args.push('--force')
        }
        args.push('--', request.targetPath)
        return { command: 'datalad', args, options: {} }
      }
      case 'createSubdataset': {
        const parentPath = request.projectPath
        const relativePath = request.relativePath
        if (!isSafeRelativeSubdatasetPath(relativePath)) {
          throw new Error(`Invalid subdataset path: ${relativePath}`)
        }
        const args = ['create', '-d', parentPath]
        if (request.procedure) {
          args.push('-c', request.procedure)
        }
        if (request.force) {
          args.push('--force')
        }
        args.push('--', relativePath)
        return { command: 'datalad', args, options: { cwd: parentPath } }
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
        // `--message=<value>` binds the whole value as one token, so a message that happens to look
        // like a flag (e.g. "--amend") can't be misparsed the way `-m <value>` can.
        return {
          command: 'datalad',
          args: paths.length > 0
            ? ['-C', projectPath, 'save', `--message=${message}`, '--', ...paths]
            : ['-C', projectPath, 'save', `--message=${message}`],
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
      case 'disconnectRemote': {
        const projectPath = request.projectPath
        const remoteName = request.remoteName
        return {
          command: 'datalad',
          args: ['siblings', 'remove', '-d', projectPath, '-s', remoteName],
          options: { cwd: projectPath }
        }
      }
      case 'createSibling': {
        const projectPath = request.projectPath
        const siblingName = request.siblingName
        const sshUrl = request.sshUrl
        return {
          command: 'datalad',
          args: ['-C', projectPath, 'create-sibling', '-s', siblingName, '--', sshUrl],
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
      case 'createBranchAt': {
        const projectPath = request.projectPath
        const branchName = request.branchName
        const startPoint = request.startPoint
        if (!COMMIT_HASH_PATTERN.test(startPoint)) {
          throw new Error(`Invalid start point format: ${startPoint}`)
        }
        return {
          command: 'git',
          args: ['-C', projectPath, 'checkout', '-b', branchName, startPoint],
          options: { cwd: projectPath }
        }
      }
      case 'restoreFileFromCommit': {
        const projectPath = request.projectPath
        const commitHash = request.commitHash
        if (!COMMIT_HASH_PATTERN.test(commitHash)) {
          throw new Error(`Invalid commit hash format: ${commitHash}`)
        }
        return {
          command: 'git',
          args: ['-C', projectPath, 'restore', `--source=${commitHash}`, '--worktree', '--', ...request.paths],
          options: { cwd: projectPath }
        }
      }
      case 'discardChanges': {
        const projectPath = request.projectPath
        // --staged --worktree returns the file fully to the last save point even if
        // something already staged it (datalad save stages as part of saving).
        return {
          command: 'git',
          args: ['-C', projectPath, 'restore', '--source=HEAD', '--staged', '--worktree', '--', ...request.paths],
          options: { cwd: projectPath }
        }
      }
      case 'unlock': {
        const projectPath = request.projectPath
        return {
          command: 'datalad',
          args: ['-C', projectPath, 'unlock', '--', ...request.paths],
          options: { cwd: projectPath }
        }
      }
      default:
        throw new Error(`Unsupported command: ${commandName}`)
    }
  }
}

// lstat, not access/stat — existence must not depend on a symlink resolving.
// A git-annex file that's been cloned but not yet `get`'d is a symlink whose
// target doesn't exist locally; it still very much exists as a tracked path
// (e.g. for isBids's dataset_description.json check), so following the link
// would incorrectly report it as missing.
async function fileExists(path) {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

// .gitmodules `path =` values come from repository content, which may belong to a cloned/untrusted
// dataset. Every consumer joins this value onto a filesystem path, so a `../` or absolute path here
// would let a malicious dataset make the app read or write outside the project directory.
function isSafeRelativeSubdatasetPath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    return false
  }

  if (relativePath.startsWith('/') || relativePath.startsWith('\\') || /^[a-zA-Z]:/.test(relativePath)) {
    return false
  }

  const segments = relativePath.split(/[\\/]+/)
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

export function createDataLadAdapter(options) {
  return new DataLadAdapter(options)
}