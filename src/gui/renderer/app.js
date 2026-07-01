import { computeDatasetGating, computeRemoteGating } from './button-gating.js'
import { computeSaveGating } from './save-gating.js'
import { computeSaveStatusChip, computeSyncStatusChip, computeMissingContentChip } from './project-health-chips.js'

const api = window.dataladDesktop

const state = {
  rootProjectPath: null,
  rootProjectClassification: 'unknown',
  fileListing: null,
  commitMetaRequestToken: 0,
  requestTokens: {
    datasets: 0,
    files: 0,
    branches: 0,
    workingTree: 0,
    recentCommits: 0,
    projectHealth: 0
  },
  recentProjects: [],
  recentProjectEmojiByPath: {},
  recentProjectTitleByPath: {},
  workingTreeSnapshot: null,
  selectedChangedPaths: new Set(),
  hasExplicitChangedSelection: false,
  recentCommits: [],
  pendingCommands: new Set(),
  projectHealthSnapshot: null,
  pendingHealthFetch: null,
  datasets: [],
  datasetsRootPath: null,
  selectedIgnoreScopePaths: new Set(),
  consoleHistory: [],
  watchRefreshPending: false
}

const DAY_IN_MS = 24 * 60 * 60 * 1000
const MAX_RECENT_PROJECTS = 8
const MAX_CONSOLE_HISTORY = 20
const RECENT_PROJECTS_STORAGE_KEY = 'dataladDesktop.recentProjects'
const RECENT_PROJECT_EMOJIS_STORAGE_KEY = 'dataladDesktop.recentProjectEmojis'
const RECENT_PROJECT_TITLES_STORAGE_KEY = 'dataladDesktop.recentProjectTitles'
const POWER_USER_MODE_STORAGE_KEY = 'dataladDesktop.powerUserMode'
const PROJECT_EMOJI_CHOICES = ['🧪', '🧬', '🧠', '🛰️', '📊', '📁', '📝', '🔬', '🗂️', '🧭', '📚', '🦉']

const elements = {
  recentProjectsOutput: document.getElementById('recent-projects-output'),
  clearRecentProjectsButton: document.getElementById('clear-recent-projects'),
  getRemoteModeUrlRadio: document.getElementById('get-remote-mode-url'),
  getRemoteModeNetworkRadio: document.getElementById('get-remote-mode-network'),
  getRemoteUrlPanel: document.getElementById('get-remote-url-panel'),
  getRemoteNetworkPanel: document.getElementById('get-remote-network-panel'),
  getRemoteSourceUrl: document.getElementById('get-remote-source-url'),
  getRemoteSourceNetwork: document.getElementById('get-remote-source-network'),
  pickGetRemoteNetworkPathButton: document.getElementById('pick-get-remote-network-path'),
  getRemoteTarget: document.getElementById('get-remote-target'),
  pickGetRemoteTargetButton: document.getElementById('pick-get-remote-target'),
  getFromRemoteButton: document.getElementById('get-from-remote'),
  getRemoteOutput: document.getElementById('get-remote-output'),
  projectPath: document.getElementById('project-path'),
  pickProjectPathButton: document.getElementById('pick-project-path'),
  commandProjectPath: document.getElementById('command-project-path'),
  pickCommandProjectPathButton: document.getElementById('pick-command-project-path'),
  currentProjectPath: document.getElementById('current-project-path'),
  currentProjectIcon: document.getElementById('current-project-icon'),
  currentProjectTitleInput: document.getElementById('current-project-title-input'),
  currentProjectNestedInfo: document.getElementById('current-project-nested-info'),
  currentProjectBadge: document.getElementById('current-project-badge'),
  switchProjectButton: document.getElementById('switch-project'),
  onboardingGroup: document.getElementById('onboarding-group'),
  projectStrip: document.getElementById('project-strip'),
  projectHealthCard: document.getElementById('project-health-card'),
  projectSetupZone: document.getElementById('project-setup-zone'),
  projectWorkspaceGrid: document.getElementById('project-workspace-grid'),
  technicalDetailsAside: document.getElementById('technical-details-aside'),
  projectHealthOutput: document.getElementById('project-health-output'),
  lastActionState: document.getElementById('last-action-state'),
  lastCommitMeta: document.getElementById('last-commit-meta'),
  createProjectPath: document.getElementById('create-project-path'),
  pickCreateProjectPathButton: document.getElementById('pick-create-project-path'),
  createProjectButton: document.getElementById('create-project'),
  createProjectOutput: document.getElementById('create-project-output'),
  datasetSelectField: document.getElementById('dataset-select-field'),
  datasetSelect: document.getElementById('dataset-select'),
  refreshDatasetsButton: document.getElementById('refresh-datasets'),
  branchSelect: document.getElementById('branch-select'),
  refreshBranchesButton: document.getElementById('refresh-branches'),
  switchBranchButton: document.getElementById('switch-branch'),
  createBranchButton: document.getElementById('create-branch'),
  newBranchNameInput: document.getElementById('new-branch-name'),
  branchStatus: document.getElementById('branch-status'),
  workingTreeSummary: document.getElementById('working-tree-summary'),
  changedFilesOutput: document.getElementById('changed-files-output'),
  changedFilesSelectAllButton: document.getElementById('changed-files-select-all'),
  changedFilesSelectNoneButton: document.getElementById('changed-files-select-none'),
  ignoreRulesScopeRoot: document.getElementById('ignore-rules-scope-root'),
  ignoreRulesScopeSelectAllButton: document.getElementById('ignore-rules-scope-select-all'),
  ignoreRulesScopeSelectNoneButton: document.getElementById('ignore-rules-scope-select-none'),
  ignoreRulesScopeDetails: document.getElementById('ignore-rules-scope-details'),
  ignoreRulesScopeSummaryLabel: document.getElementById('ignore-rules-scope-summary-label'),
  ignoreRulesScopeTree: document.getElementById('ignore-rules-scope-tree'),
  ignoreRulesPatterns: document.getElementById('ignore-rules-patterns'),
  ignoreRulesApplyButton: document.getElementById('ignore-rules-apply'),
  ignoreRulesAddOsJunkButton: document.getElementById('ignore-rules-add-os-junk'),
  ignoreRulesOutput: document.getElementById('ignore-rules-output'),
  recentCommitsOutput: document.getElementById('recent-commits-output'),
  saveProjectButton: document.getElementById('save-project'),
  getDataButton: document.getElementById('get-data'),
  updateProjectButton: document.getElementById('update-project'),
  publishProjectButton: document.getElementById('publish-project'),
  openActiveFolderButton: document.getElementById('open-active-folder'),
  refreshFilesButton: document.getElementById('refresh-files'),
  filesSearchInput: document.getElementById('files-search'),
  message: document.getElementById('message'),
  saveGuidance: document.getElementById('save-guidance'),
  paths: document.getElementById('paths'),
  checkEnvButton: document.getElementById('check-env'),
  detectProjectButton: document.getElementById('detect-project'),
  refreshContractButton: document.getElementById('refresh-contract'),
  environmentOutput: document.getElementById('environment-output'),
  classificationOutput: document.getElementById('classification-output'),
  commandOutput: document.getElementById('command-output'),
  filesOutput: document.getElementById('files-output'),
  contractOutput: document.getElementById('contract-output'),
  remoteInfo: document.getElementById('remote-info'),
  powerUserModeToggle: document.getElementById('power-user-mode-toggle'),
  powerUserConsole: document.getElementById('power-user-console'),
  consoleHelpText: document.getElementById('console-help-text'),
  consoleProjectPath: document.getElementById('console-project-path'),
  consoleCommand: document.getElementById('console-command'),
  consoleRunButton: document.getElementById('console-run'),
  consoleOutput: document.getElementById('console-output'),
  consoleHistoryOutput: document.getElementById('console-history-output')
}

loadRecentProjects()
await seedWorkspacePath()
await renderContract()

// Never auto-load a project on start. Only "Latest Projects" and "Open
// Project" should be visible until the user explicitly opens, clones, or
// picks a recent one — every other card stays hidden until then.
elements.commandProjectPath.value = ''
setCurrentProjectHeader('', 'unknown')
updateSaveButtonState()
initPowerUserConsole()

wireFolderPicker(elements.pickProjectPathButton, elements.projectPath, {
  title: 'Select project folder',
  mirrorTo: elements.commandProjectPath,
  setAsCurrentProject: true
})

wireFolderPicker(elements.pickCommandProjectPathButton, elements.commandProjectPath, {
  title: 'Select command project folder',
  setAsCurrentProject: true
})

wireFolderPicker(elements.pickGetRemoteNetworkPathButton, elements.getRemoteSourceNetwork, {
  title: 'Select network or local source folder'
})

wireFolderPicker(elements.pickGetRemoteTargetButton, elements.getRemoteTarget, {
  title: 'Select target folder for the downloaded project'
})

wireFolderPicker(elements.pickCreateProjectPathButton, elements.createProjectPath, {
  title: 'Select or create a new project folder'
})

elements.recentProjectsOutput.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-recent-project-path]')
  if (!target) {
    return
  }

  const projectPath = target.getAttribute('data-recent-project-path')?.trim()
  if (!projectPath) {
    return
  }

  setLastActionState('Switching to recent project...', 'idle')
  elements.projectPath.value = projectPath
  elements.commandProjectPath.value = projectPath
  setCurrentProjectHeader(projectPath, 'unknown')
  await detectProjectType(projectPath)
})

elements.switchProjectButton.addEventListener('click', () => {
  setOnboardingExpanded(true)
})

elements.clearRecentProjectsButton.addEventListener('click', () => {
  state.recentProjects = []
  persistRecentProjects()
  renderRecentProjects()
  setLastActionState('Recent project list cleared.', 'idle')
})

elements.changedFilesSelectAllButton.addEventListener('click', () => {
  const filePaths = (state.workingTreeSnapshot?.files ?? []).map((entry) => entry.path)
  state.selectedChangedPaths = new Set(filePaths)
  state.hasExplicitChangedSelection = true
  renderChangedFilesSelection()
  updateSaveButtonState()
})

elements.changedFilesSelectNoneButton.addEventListener('click', () => {
  state.selectedChangedPaths = new Set()
  state.hasExplicitChangedSelection = true
  renderChangedFilesSelection()
  updateSaveButtonState()
})

elements.changedFilesOutput.addEventListener('input', (event) => {
  const checkbox = event.target.closest('[data-changed-path]')
  if (!checkbox) {
    return
  }

  const relativePath = checkbox.getAttribute('data-changed-path')
  if (!relativePath) {
    return
  }

  if (checkbox.checked) {
    state.selectedChangedPaths.add(relativePath)
  } else {
    state.selectedChangedPaths.delete(relativePath)
  }

  state.hasExplicitChangedSelection = true
  updateSaveButtonState()
})

elements.message.addEventListener('input', () => {
  updateSaveButtonState()
})

elements.paths.addEventListener('input', () => {
  updateSaveButtonState()
})

elements.checkEnvButton.addEventListener('click', async () => {
  setButtonBusy(elements.checkEnvButton, true)
  try {
    const diagnostics = await api.checkEnvironment()
    elements.environmentOutput.hidden = false
    elements.environmentOutput.innerHTML = renderEnvironment(diagnostics)
  } catch (error) {
    elements.environmentOutput.hidden = false
    elements.environmentOutput.textContent = String(error.message)
  } finally {
    setButtonBusy(elements.checkEnvButton, false)
  }
})

elements.detectProjectButton.addEventListener('click', async () => {
  const projectPath = elements.projectPath.value.trim()
  if (!projectPath) {
    elements.classificationOutput.hidden = false
    elements.classificationOutput.textContent = 'Please choose a project folder first.'
    setLastActionState('Choose a project folder first.', 'error')
    return
  }

  setButtonBusy(elements.detectProjectButton, true)
  try {
    await detectProjectType(projectPath)
  } finally {
    setButtonBusy(elements.detectProjectButton, false)
  }
})

function updateGetRemoteMode() {
  const isUrl = elements.getRemoteModeUrlRadio.checked
  elements.getRemoteUrlPanel.hidden = !isUrl
  elements.getRemoteNetworkPanel.hidden = isUrl
}

elements.getRemoteModeUrlRadio.addEventListener('change', updateGetRemoteMode)
elements.getRemoteModeNetworkRadio.addEventListener('change', updateGetRemoteMode)

elements.getFromRemoteButton.addEventListener('click', async () => {
  const isUrl = elements.getRemoteModeUrlRadio.checked
  const source = isUrl
    ? elements.getRemoteSourceUrl.value.trim()
    : elements.getRemoteSourceNetwork.value.trim()
  const targetPath = elements.getRemoteTarget.value.trim()

  if (!source || !targetPath) {
    elements.getRemoteOutput.hidden = false
    elements.getRemoteOutput.textContent = 'Provide both a source and a target folder.'
    setLastActionState('Add source and target folder.', 'error')
    return
  }

  // This runs in the onboarding area before any project is open — render the
  // result here too, not just into the Save & Sync panel (hidden until open).
  const cloneResult = await runWorkflowCommand('cloneInstall', { source, targetPath }, elements.getFromRemoteButton)
  if (cloneResult) {
    elements.getRemoteOutput.hidden = false
    elements.getRemoteOutput.innerHTML = renderCommandResult(cloneResult)
  }
  if (!cloneResult?.ok) {
    return
  }

  elements.commandProjectPath.value = targetPath
  elements.projectPath.value = targetPath
  setCurrentProjectHeader(targetPath, 'unknown')
  await detectProjectType(targetPath)
  await refreshDatasetList(targetPath)
  await refreshFileBrowser(targetPath)
})

elements.createProjectButton.addEventListener('click', async () => {
  const targetPath = elements.createProjectPath.value.trim()

  if (!targetPath) {
    elements.createProjectOutput.hidden = false
    elements.createProjectOutput.textContent = 'Choose a folder for the new project first.'
    setLastActionState('Add a target folder first.', 'error')
    return
  }

  const createResult = await runWorkflowCommand('createProject', { targetPath }, elements.createProjectButton)
  if (createResult) {
    elements.createProjectOutput.hidden = false
    elements.createProjectOutput.innerHTML = renderCommandResult(createResult)
  }
  if (!createResult?.ok) {
    return
  }

  elements.commandProjectPath.value = targetPath
  elements.projectPath.value = targetPath
  setCurrentProjectHeader(targetPath, 'unknown')
  await detectProjectType(targetPath)
  await refreshDatasetList(targetPath)
  await refreshFileBrowser(targetPath)
})

elements.saveProjectButton.addEventListener('click', async () => {
  const projectPath = readProjectPath()
  if (!projectPath) {
    return
  }

  const message = elements.message.value.trim()

  if (!message) {
    elements.commandOutput.textContent = 'Add a save message before running Save.'
    setLastActionState('Add a save message first.', 'error')
    updateSaveButtonState()
    return
  }

  setButtonBusy(elements.saveProjectButton, true)
  try {
    const latestStatus = await refreshWorkingTreeStatus(projectPath)
    if (!latestStatus) {
      return
    }

    if (latestStatus.conflictCount > 0) {
      elements.commandOutput.textContent =
        'Save is blocked while conflicts are present. Resolve conflicts, then try again.'
      setLastActionState('Resolve conflicts before saving.', 'error')
      updateSaveButtonState()
      return
    }

    const selectedPaths = gatherSavePaths()
    if (latestStatus.totalChanged > 0 && selectedPaths.length === 0) {
      elements.commandOutput.textContent =
        'Select at least one changed file or provide manual paths before saving.'
      setLastActionState('Select files to save first.', 'error')
      return
    }

    await runWorkflowCommand('save', {
      projectPath,
      message,
      paths: selectedPaths
    }, elements.saveProjectButton)
  } finally {
    setButtonBusy(elements.saveProjectButton, false)
    updateSaveButtonState()
  }
})

elements.getDataButton.addEventListener('click', async () => {
  const projectPath = readProjectPath()
  if (!projectPath) {
    return
  }

  await runWorkflowCommand('get', {
    projectPath,
    paths: parsePaths(elements.paths.value)
  }, elements.getDataButton)

  await refreshFileBrowser(projectPath)
})

elements.updateProjectButton.addEventListener('click', async () => {
  const projectPath = readProjectPath()
  if (!projectPath) {
    return
  }

  await runWorkflowCommand('update', { projectPath }, elements.updateProjectButton)
})

elements.publishProjectButton.addEventListener('click', async () => {
  const projectPath = readProjectPath()
  if (!projectPath) {
    return
  }

  await runWorkflowCommand('push', { projectPath }, elements.publishProjectButton)
})

elements.refreshDatasetsButton.addEventListener('click', async () => {
  const projectPath = elements.projectPath.value.trim() || elements.commandProjectPath.value.trim()
  if (!projectPath) {
    setLastActionState('Select a project first.', 'error')
    return
  }

  await refreshDatasetList(projectPath)
})

elements.refreshBranchesButton.addEventListener('click', async () => {
  const projectPath = readProjectPath()
  if (!projectPath) {
    return
  }

  await refreshBranchList(projectPath)
})

elements.switchBranchButton.addEventListener('click', async () => {
  const projectPath = readProjectPath()
  if (!projectPath) {
    return
  }

  const branchName = elements.branchSelect.value.trim()
  if (!branchName) {
    setBranchStatus('Select a branch before switching.', 'error')
    setLastActionState('Select a branch before switching.', 'error')
    return
  }

  const safeToProceed = await ensureBranchActionSafety(projectPath, 'switch branches')
  if (!safeToProceed) {
    return
  }

  const result = await runWorkflowCommand('switchBranch', { projectPath, branchName }, elements.switchBranchButton)
  if (!result?.ok) {
    return
  }

  setBranchStatus(`Switched to ${branchName}.`, 'success')
  await refreshBranchList(projectPath)
})

elements.createBranchButton.addEventListener('click', async () => {
  const projectPath = readProjectPath()
  if (!projectPath) {
    return
  }

  const branchName = elements.newBranchNameInput.value.trim()
  if (!branchName) {
    setBranchStatus('Enter a branch name before creating.', 'error')
    setLastActionState('Enter a branch name before creating.', 'error')
    return
  }

  const safeToProceed = await ensureBranchActionSafety(projectPath, 'create a branch')
  if (!safeToProceed) {
    return
  }

  const result = await runWorkflowCommand('createBranch', { projectPath, branchName }, elements.createBranchButton)
  if (!result?.ok) {
    return
  }

  elements.newBranchNameInput.value = ''
  setBranchStatus(`Created and switched to ${branchName}.`, 'success')
  await refreshBranchList(projectPath)
})

elements.datasetSelect.addEventListener('change', async () => {
  const selectedDatasetPath = elements.datasetSelect.value
  if (!selectedDatasetPath) {
    return
  }

  elements.commandProjectPath.value = selectedDatasetPath
  setCurrentProjectHeader(selectedDatasetPath, classificationForPath(selectedDatasetPath))
  setLastActionState('Active data folder changed.', 'success')
  await refreshFileBrowser(selectedDatasetPath)
  await refreshBranchList(selectedDatasetPath)
  await refreshWorkingTreeStatus(selectedDatasetPath)
  await refreshRecentCommits(selectedDatasetPath)
})

elements.refreshFilesButton.addEventListener('click', async () => {
  const projectPath = readProjectPath()
  if (!projectPath) {
    return
  }

  await refreshFileBrowser(projectPath)
})

elements.openActiveFolderButton.addEventListener('click', async () => {
  const projectPath = readProjectPath()
  if (!projectPath) {
    return
  }

  await revealPath(projectPath)
})

elements.filesSearchInput.addEventListener('input', () => {
  renderCurrentFileBrowser()
})

elements.filesOutput.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-entry-path]')
  if (!target) {
    return
  }

  event.preventDefault()
  const targetPath = target.getAttribute('data-entry-path')
  if (!targetPath) {
    return
  }

  await revealPath(targetPath)
})

elements.refreshContractButton.addEventListener('click', async () => {
  await renderContract()
})

api.onFilesChanged(({ projectPath }) => {
  if (!projectPath || projectPath !== state.rootProjectPath) {
    return
  }

  if (state.pendingCommands.size > 0) {
    state.watchRefreshPending = true
    return
  }

  void refreshWorkingTreeStatus(state.rootProjectPath)
  void refreshFileBrowser(state.rootProjectPath)
})

async function detectProjectType(projectPath) {
  try {
    const result = await api.detectProject(projectPath)
    elements.classificationOutput.hidden = false
    elements.classificationOutput.innerHTML = renderProjectCheckOutput(result)
    state.rootProjectPath = projectPath
    state.rootProjectClassification = result.classification
    setCurrentProjectHeader(projectPath, result.classification)
    rememberRecentProject(projectPath)
    void api.setWatchedProject(projectPath)
    setLastActionState(`Project check finished: ${friendlyProjectTypeLabel(result.classification)}.`, 'success')
    // refreshDatasetList already refreshes working tree/recent commits for
    // the resolved active path on success — repeating them here would spawn
    // the same real git subprocesses a second time for no reason and was
    // making project opens feel sluggish. Only fall back to refreshing them
    // directly if dataset listing itself failed and skipped that work.
    const datasetsRefreshed = await refreshDatasetList(projectPath)
    await refreshFileBrowser(elements.commandProjectPath.value.trim() || projectPath)
    if (!datasetsRefreshed) {
      await refreshWorkingTreeStatus(elements.commandProjectPath.value.trim() || projectPath)
      await refreshRecentCommits(elements.commandProjectPath.value.trim() || projectPath)
      updateSaveButtonState()
    }
  } catch (error) {
    elements.classificationOutput.hidden = false
    elements.classificationOutput.textContent = String(error.message)
    setLastActionState('Could not check this project folder.', 'error')
  }
}

function readProjectPath() {
  const path = elements.commandProjectPath.value.trim()
  if (!path) {
    elements.commandOutput.textContent = 'Set an active project folder first.'
    setLastActionState('Set an active project folder first.', 'error')
    return null
  }
  return path
}

async function runWorkflowCommand(commandName, request, button = null) {
  if (state.pendingCommands.has(commandName)) {
    setLastActionState(`${actionLabel(commandName)} is already running.`, 'warning')
    return null
  }

  state.pendingCommands.add(commandName)
  const pathCount = Array.isArray(request.paths) ? request.paths.length : 0
  const busyLabel =
    commandName === 'save' && pathCount > BUSY_LABEL_FILE_COUNT_THRESHOLD ? `Saving ${pathCount} files…` : undefined
  setButtonBusy(button, true, busyLabel)

  try {
    const result = await api.runCommand(commandName, request)

    const nextProjectPath = request.projectPath ?? request.targetPath
    let saveSummary = null
    if (result.ok && nextProjectPath) {
      void refreshLastCommitMeta(nextProjectPath)
      if (commandName === 'createBranch' || commandName === 'switchBranch') {
        void refreshBranchList(nextProjectPath)
      }

      if (commandName === 'save') {
        saveSummary = await buildSaveSummary(nextProjectPath, request.paths ?? [])
      }

      void refreshWorkingTreeStatus(nextProjectPath)
      void refreshRecentCommits(nextProjectPath)
      void refreshProjectHealth(nextProjectPath)
    }

    elements.commandOutput.innerHTML = renderCommandResult(result, saveSummary)

    if (!result.ok && nextProjectPath) {
      void refreshWorkingTreeStatus(nextProjectPath)
    }

    if (result.ok) {
      setLastActionState(
        result.warnings?.length
          ? `${actionLabel(commandName)} completed with advisories.`
          : `${actionLabel(commandName)} completed.`,
        result.warnings?.length ? 'warning' : 'success'
      )
    } else {
      setLastActionState(`${actionLabel(commandName)} failed.`, 'error')
    }

    return result
  } catch (error) {
    elements.commandOutput.textContent = String(error.message)
    setLastActionState(`${actionLabel(commandName)} failed.`, 'error')
    return null
  } finally {
    state.pendingCommands.delete(commandName)
    setButtonBusy(button, false)
    updateSaveButtonState()

    if (state.pendingCommands.size === 0 && state.watchRefreshPending) {
      state.watchRefreshPending = false
      void refreshWorkingTreeStatus(state.rootProjectPath)
      void refreshFileBrowser(state.rootProjectPath)
    }
  }
}

async function refreshDatasetList(projectPath) {
  if (!projectPath) {
    return
  }

  const requestToken = nextRequestToken('datasets')

  try {
    const datasets = await api.listDatasets(projectPath)
    if (!isLatestRequestToken('datasets', requestToken)) {
      return null
    }

    state.datasets = datasets
    state.datasetsRootPath = projectPath
    renderIgnoreRulesScope()

    const hasNestedDatasets = datasets.some((dataset) => dataset.relativePath !== '.')

    elements.datasetSelect.innerHTML = ''

    for (const dataset of datasets) {
      const option = document.createElement('option')
      option.value = dataset.path
      option.textContent =
        dataset.relativePath === '.'
          ? hasNestedDatasets
            ? 'Root Folder'
            : '(main project folder)'
          : dataset.relativePath
      elements.datasetSelect.appendChild(option)
    }

    // With no nested datasets there is nothing to switch between and the
    // picker just reads as confusing noise for the common single-dataset
    // case — hide the whole field rather than show a disabled dropdown.
    // Re-detecting the project (e.g. via Switch Project) picks up nested
    // datasets added later.
    elements.datasetSelectField.hidden = !hasNestedDatasets
    elements.datasetSelect.title = 'Switch between the root dataset and its nested datasets.'

    const activePath = elements.commandProjectPath.value.trim()
    const hasActivePath = datasets.some((dataset) => dataset.path === activePath)
    const nextPath = hasActivePath ? activePath : datasets[0]?.path

    if (nextPath) {
      elements.datasetSelect.value = nextPath
      elements.commandProjectPath.value = nextPath
      setCurrentProjectHeader(nextPath, classificationForPath(nextPath))
      await refreshBranchList(nextPath)
      await refreshWorkingTreeStatus(nextPath)
      await refreshRecentCommits(nextPath)
      updateSaveButtonState()
      return true
    }

    await refreshBranchList(projectPath)
    await refreshWorkingTreeStatus(projectPath)
    await refreshRecentCommits(projectPath)
    updateSaveButtonState()
    return true
  } catch (error) {
    if (!isLatestRequestToken('datasets', requestToken)) {
      return null
    }

    setLastActionState('Could not load nested datasets.', 'warning')
    elements.commandOutput.textContent = String(error.message)
  }

  return null
}

function buildIgnoreRulesScopeTree(datasets) {
  const root = { name: null, path: '', children: new Map(), isDataset: false }

  for (const dataset of datasets) {
    const segments = dataset.relativePath.split('/')
    let node = root
    let pathSoFar = ''

    segments.forEach((segment, index) => {
      pathSoFar = pathSoFar ? `${pathSoFar}/${segment}` : segment
      if (!node.children.has(segment)) {
        node.children.set(segment, { name: segment, path: pathSoFar, children: new Map(), isDataset: false })
      }
      node = node.children.get(segment)
      if (index === segments.length - 1) {
        node.isDataset = true
      }
    })
  }

  return root
}

function renderIgnoreRulesScopeTreeNode(node, depth) {
  const items = [...node.children.values()]
    .map((child) => {
      const nestedHtml = renderIgnoreRulesScopeTreeNode(child, depth + 1)
      const checked = state.selectedIgnoreScopePaths.has(child.path) ? ' checked' : ''
      const entryHtml = child.isDataset
        ? '<label class="ignore-rules-scope-option">' +
          `<input type="checkbox" class="ignore-rules-scope-toggle" data-scope-path="${escapeHtml(child.path)}"${checked} />` +
          `<span>${escapeHtml(child.name)}</span>` +
          '</label>'
        : `<span class="ignore-rules-scope-folder">${escapeHtml(child.name)}/</span>`

      return `<li class="ignore-rules-scope-node">${entryHtml}${nestedHtml}</li>`
    })
    .join('')

  return items ? `<ul class="ignore-rules-scope-tree-list depth-${depth}">${items}</ul>` : ''
}

function renderIgnoreRulesScope() {
  const datasets = state.datasets ?? []

  const availableRelativePaths = new Set(datasets.map((dataset) => dataset.relativePath))
  for (const selectedPath of [...state.selectedIgnoreScopePaths]) {
    if (!availableRelativePaths.has(selectedPath)) {
      state.selectedIgnoreScopePaths.delete(selectedPath)
    }
  }

  const hasRoot = datasets.some((dataset) => dataset.relativePath === '.')
  elements.ignoreRulesScopeRoot.disabled = !hasRoot
  elements.ignoreRulesScopeRoot.checked = hasRoot && state.selectedIgnoreScopePaths.has('.')

  const nestedDatasets = datasets.filter((dataset) => dataset.relativePath !== '.')
  if (nestedDatasets.length === 0) {
    elements.ignoreRulesScopeTree.innerHTML =
      '<p class="hint-inline">Choose a project to manage ignore rules.</p>'
    elements.ignoreRulesScopeSummaryLabel.textContent = 'Choose specific nested datasets'
    elements.ignoreRulesScopeSelectAllButton.disabled = datasets.length === 0
    elements.ignoreRulesScopeSelectNoneButton.disabled = datasets.length === 0
  } else {
    const tree = buildIgnoreRulesScopeTree(nestedDatasets)
    elements.ignoreRulesScopeTree.innerHTML = renderIgnoreRulesScopeTreeNode(tree, 0)
    elements.ignoreRulesScopeSummaryLabel.textContent = `Choose specific nested datasets (${nestedDatasets.length})`
    elements.ignoreRulesScopeSelectAllButton.disabled = false
    elements.ignoreRulesScopeSelectNoneButton.disabled = false
  }

  updateIgnoreRulesApplyState()
}

function updateIgnoreRulesApplyState() {
  const hasScope = state.selectedIgnoreScopePaths.size > 0
  const hasPatterns = elements.ignoreRulesPatterns.value.trim().length > 0
  elements.ignoreRulesApplyButton.disabled = !(hasScope && hasPatterns)
}

elements.ignoreRulesScopeRoot.addEventListener('change', () => {
  if (elements.ignoreRulesScopeRoot.checked) {
    state.selectedIgnoreScopePaths.add('.')
  } else {
    state.selectedIgnoreScopePaths.delete('.')
  }

  updateIgnoreRulesApplyState()
})

elements.ignoreRulesScopeTree.addEventListener('change', (event) => {
  const checkbox = event.target.closest('[data-scope-path]')
  if (!checkbox) {
    return
  }

  const relativePath = checkbox.getAttribute('data-scope-path')
  if (!relativePath) {
    return
  }

  if (checkbox.checked) {
    state.selectedIgnoreScopePaths.add(relativePath)
  } else {
    state.selectedIgnoreScopePaths.delete(relativePath)
  }

  updateIgnoreRulesApplyState()
})

elements.ignoreRulesScopeSelectAllButton.addEventListener('click', () => {
  state.selectedIgnoreScopePaths = new Set((state.datasets ?? []).map((dataset) => dataset.relativePath))
  renderIgnoreRulesScope()
})

elements.ignoreRulesScopeSelectNoneButton.addEventListener('click', () => {
  state.selectedIgnoreScopePaths = new Set()
  renderIgnoreRulesScope()
})

elements.ignoreRulesPatterns.addEventListener('input', () => {
  updateIgnoreRulesApplyState()
})

elements.ignoreRulesAddOsJunkButton.addEventListener('click', () => {
  const commonPatterns = ['.DS_Store', '._*', 'Thumbs.db', 'Desktop.ini']
  const existingLines = elements.ignoreRulesPatterns.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const mergedLines = [...new Set([...existingLines, ...commonPatterns])]
  elements.ignoreRulesPatterns.value = mergedLines.join('\n')
  updateIgnoreRulesApplyState()
})

elements.ignoreRulesApplyButton.addEventListener('click', async () => {
  const projectPath = state.datasetsRootPath
  if (!projectPath) {
    return
  }

  const patterns = elements.ignoreRulesPatterns.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const scopePaths = [...state.selectedIgnoreScopePaths]

  if (patterns.length === 0 || scopePaths.length === 0) {
    return
  }

  elements.ignoreRulesApplyButton.disabled = true
  try {
    const results = await api.addIgnorePatterns(projectPath, scopePaths, patterns)
    elements.ignoreRulesOutput.innerHTML = renderIgnoreRulesResult(results)
    elements.ignoreRulesPatterns.value = ''
    setLastActionState('Updated .gitignore for the selected scope.', 'success')
    await refreshWorkingTreeStatus(elements.commandProjectPath.value.trim() || projectPath)
  } catch (error) {
    elements.ignoreRulesOutput.textContent = String(error.message)
    setLastActionState('Could not update .gitignore.', 'error')
  } finally {
    updateIgnoreRulesApplyState()
  }
})

function renderIgnoreRulesResult(results) {
  const rows = results
    .map((result) => {
      const label = result.relativeDatasetPath === '.' ? '(main project folder)' : result.relativeDatasetPath
      const summary = result.addedPatterns.length
        ? `added ${result.addedPatterns.join(', ')}`
        : 'already up to date'
      return `<li>${escapeHtml(label)}: ${escapeHtml(summary)}</li>`
    })
    .join('')

  return `<ul class="history-list">${rows}</ul>`
}

async function refreshFileBrowser(projectPath) {
  if (!projectPath) {
    return
  }

  const requestToken = nextRequestToken('files')

  try {
    const listing = await api.listFileEntries(projectPath, { maxDepth: 4, maxEntries: 500 })
    if (!isLatestRequestToken('files', requestToken)) {
      return
    }

    state.fileListing = listing
    renderCurrentFileBrowser()
  } catch (error) {
    if (!isLatestRequestToken('files', requestToken)) {
      return
    }

    state.fileListing = null
    elements.filesOutput.textContent = `Could not load files: ${String(error.message)}`
  }
}

async function refreshBranchList(projectPath) {
  if (!projectPath) {
    elements.branchSelect.innerHTML = ''
    elements.switchBranchButton.disabled = true
    setBranchStatus('Load a project to manage branches.', 'idle')
    return
  }

  const requestToken = nextRequestToken('branches')
  setBranchStatus('Loading branches...', 'idle')

  try {
    const branchSnapshot = await api.listBranches(projectPath)
    if (!isLatestRequestToken('branches', requestToken)) {
      return
    }

    const branchNames = Array.isArray(branchSnapshot.branches) ? branchSnapshot.branches : []
    elements.branchSelect.innerHTML = ''

    if (branchNames.length === 0) {
      const emptyOption = document.createElement('option')
      emptyOption.value = ''
      emptyOption.textContent = '(no local branches)'
      elements.branchSelect.appendChild(emptyOption)
      elements.switchBranchButton.disabled = true
      setBranchStatus('No local branches found.', 'error')
      return
    }

    for (const branchName of branchNames) {
      const option = document.createElement('option')
      option.value = branchName
      option.textContent = branchName
      elements.branchSelect.appendChild(option)
    }

    const currentBranch = branchSnapshot.currentBranch?.trim()
    if (currentBranch && branchNames.includes(currentBranch)) {
      elements.branchSelect.value = currentBranch
      setBranchStatus(`Current branch: ${currentBranch}`, 'success')
    } else if (branchSnapshot.detachedHead) {
      setBranchStatus('Detached HEAD detected. Choose a branch to switch.', 'error')
    } else {
      setBranchStatus('Choose a branch to switch.', 'idle')
    }

    elements.switchBranchButton.disabled = false
  } catch (error) {
    if (!isLatestRequestToken('branches', requestToken)) {
      return
    }

    elements.branchSelect.innerHTML = ''
    const fallbackOption = document.createElement('option')
    fallbackOption.value = ''
    fallbackOption.textContent = '(branch list unavailable)'
    elements.branchSelect.appendChild(fallbackOption)
    elements.switchBranchButton.disabled = true
    setBranchStatus('Could not load branches.', 'error')
    elements.commandOutput.textContent = String(error.message)
  }
}

async function refreshWorkingTreeStatus(
  projectPath,
  { preserveSelection = true, includeCommandOutputOnFailure = true } = {}
) {
  if (!projectPath) {
    state.workingTreeSnapshot = null
    state.selectedChangedPaths = new Set()
    state.hasExplicitChangedSelection = false
    renderWorkingTreeSummary()
    renderChangedFilesSelection()
    renderProjectHealth()
    updateSaveButtonState()
    return null
  }

  const requestToken = nextRequestToken('workingTree')
  elements.workingTreeSummary.innerHTML = loadingPanelHtml('Scanning working tree… large projects can take a while.')
  elements.changedFilesOutput.innerHTML = loadingPanelHtml('Scanning for changed files…')

  try {
    const snapshot = await api.getWorkingTreeStatus(projectPath)
    if (!isLatestRequestToken('workingTree', requestToken)) {
      return snapshot
    }

    state.workingTreeSnapshot = snapshot
    syncSelectedChangedPaths(snapshot.files ?? [], preserveSelection)
    renderWorkingTreeSummary()
    renderChangedFilesSelection()
    renderProjectHealth()
    updateSaveButtonState()
    return snapshot
  } catch (error) {
    if (!isLatestRequestToken('workingTree', requestToken)) {
      return null
    }

    state.workingTreeSnapshot = null
    state.selectedChangedPaths = new Set()
    state.hasExplicitChangedSelection = false
    renderWorkingTreeSummary(`Could not load working tree status: ${String(error.message)}`)
    renderChangedFilesSelection()
    renderProjectHealth()
    updateSaveButtonState()

    if (includeCommandOutputOnFailure) {
      elements.commandOutput.textContent = String(error.message)
    }

    return null
  }
}

async function refreshRecentCommits(projectPath, { includeCommandOutputOnFailure = true } = {}) {
  if (!projectPath) {
    state.recentCommits = []
    renderRecentCommitList()
    return []
  }

  const requestToken = nextRequestToken('recentCommits')

  try {
    const history = await api.listRecentCommits(projectPath, { limit: 20 })
    if (!isLatestRequestToken('recentCommits', requestToken)) {
      return history.commits ?? []
    }

    state.recentCommits = history.commits ?? []
    renderRecentCommitList()
    return state.recentCommits
  } catch (error) {
    if (!isLatestRequestToken('recentCommits', requestToken)) {
      return []
    }

    state.recentCommits = []
    renderRecentCommitList(`Could not load recent commits: ${String(error.message)}`)
    if (includeCommandOutputOnFailure) {
      elements.commandOutput.textContent = String(error.message)
    }
    return []
  }
}

async function revealPath(targetPath) {
  try {
    await api.revealPath(targetPath)
    setLastActionState('Opened in file manager.', 'success')
  } catch (error) {
    setLastActionState('Could not open file manager path.', 'error')
    elements.commandOutput.textContent = String(error.message)
  }
}

function renderCurrentFileBrowser() {
  if (!state.fileListing) {
    elements.filesOutput.textContent = 'Select or detect a project to load files.'
    return
  }

  const query = elements.filesSearchInput.value.trim().toLowerCase()
  elements.filesOutput.innerHTML = renderFileListing(state.fileListing, query)
}

function parsePaths(text) {
  if (!text.trim()) {
    return []
  }
  return text
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function wireFolderPicker(button, input, options) {
  button.addEventListener('click', async () => {
    let selectedPath = null
    try {
      selectedPath = await api.pickDirectory({
        title: options.title,
        defaultPath: input.value.trim()
      })
    } catch (error) {
      setLastActionState('Could not open folder picker.', 'error')
      elements.commandOutput.textContent = String(error.message ?? error)
      return
    }

    if (!selectedPath) {
      setLastActionState('Folder selection canceled.', 'idle')
      return
    }

    input.value = selectedPath
    if (options.mirrorTo) {
      options.mirrorTo.value = selectedPath
    }

    if (options.setAsCurrentProject) {
      setCurrentProjectHeader(selectedPath, getCurrentBadgeType())
      rememberRecentProject(selectedPath)
      await refreshDatasetList(selectedPath)
      await refreshFileBrowser(selectedPath)
      await refreshBranchList(selectedPath)
      await refreshWorkingTreeStatus(selectedPath)
      await refreshRecentCommits(selectedPath)
      updateSaveButtonState()
    }

    setLastActionState('Folder selected.', 'success')
  })
}

async function seedWorkspacePath() {
  try {
    const workspaceRoot = await api.getWorkspaceRoot()
    // Suggests a starting point for the "Open Project" field only. The
    // active project (commandProjectPath) is seeded from the most recently
    // used project instead, since cwd has no relation to a real project
    // for anyone running the packaged app.
    elements.projectPath.value = workspaceRoot
  } catch {
    // Ignore if workspace path is unavailable.
  }
}

async function renderContract() {
  try {
    const contract = await api.getContract()
    elements.contractOutput.textContent = JSON.stringify(contract, null, 2)
  } catch (error) {
    elements.contractOutput.textContent = String(error.message)
  }
}

function renderEnvironment(diagnostics) {
  const report = diagnostics.report
  const checksHtml = report.checks
    .map((check) => {
      const status = check.status === 'ok' ? 'OK' : 'MISSING'
      const details = check.version || check.details || 'No details'
      return `<li><strong>${escapeHtml(check.label)}:</strong> ${escapeHtml(status)} - ${escapeHtml(details)}</li>`
    })
    .join('')

  const stepsHtml = report.recoverySteps.length
    ? `<ol>${report.recoverySteps
        .map((step) => `<li>${escapeHtml(step)}</li>`)
        .join('')}</ol>`
    : '<p>No recovery steps needed.</p>'

  return (
    `<p><strong>${escapeHtml(report.headline)}</strong></p>` +
    `<p>${escapeHtml(report.summary)}</p>` +
    `<ul>${checksHtml}</ul>` +
    stepsHtml
  )
}

function syncSelectedChangedPaths(files, preserveSelection) {
  const availablePaths = new Set(files.map((entry) => entry.path))

  if (!preserveSelection) {
    state.selectedChangedPaths = new Set(files.map((entry) => entry.path))
    state.hasExplicitChangedSelection = false
    return
  }

  if (state.selectedChangedPaths.size === 0 && !state.hasExplicitChangedSelection) {
    state.selectedChangedPaths = new Set(files.map((entry) => entry.path))
    return
  }

  const nextSelection = new Set()
  for (const selectedPath of state.selectedChangedPaths) {
    if (availablePaths.has(selectedPath)) {
      nextSelection.add(selectedPath)
    }
  }

  state.selectedChangedPaths = nextSelection
}

function renderWorkingTreeSummary(overrideMessage = null) {
  if (overrideMessage) {
    elements.workingTreeSummary.textContent = overrideMessage
    return
  }

  const snapshot = state.workingTreeSnapshot
  if (!snapshot) {
    elements.workingTreeSummary.textContent = 'Select a project to load local change status.'
    return
  }

  if (snapshot.clean) {
    elements.workingTreeSummary.innerHTML =
      '<div class="working-tree-grid">' +
      '<span class="status-chip status-chip-good">Clean</span>' +
      '<span class="status-chip">Staged 0</span>' +
      '<span class="status-chip">Unstaged 0</span>' +
      '<span class="status-chip">Untracked 0</span>' +
      '<span class="status-chip">Conflicts 0</span>' +
      '</div>'
    return
  }

  const conflictsClass = snapshot.conflictCount > 0 ? ' status-chip-urgent' : ''
  elements.workingTreeSummary.innerHTML =
    '<div class="working-tree-grid">' +
    `<span class="status-chip">Changed ${snapshot.totalChanged}</span>` +
    `<span class="status-chip">Staged ${snapshot.stagedCount}</span>` +
    `<span class="status-chip">Unstaged ${snapshot.unstagedCount}</span>` +
    `<span class="status-chip">Untracked ${snapshot.untrackedCount}</span>` +
    `<span class="status-chip${conflictsClass}">Conflicts ${snapshot.conflictCount}</span>` +
    '</div>'
}

function renderChangedFileItem(entry) {
  const checked = state.selectedChangedPaths.has(entry.path) ? ' checked' : ''
  const stagedBadge = entry.staged ? '<span class="status-chip">staged</span>' : ''
  const conflictedBadge = entry.conflicted ? '<span class="status-chip status-chip-urgent">conflict</span>' : ''
  const submoduleBadge = entry.isSubmodule ? '<span class="status-chip">subdataset</span>' : ''
  const nestedFiles = entry.isSubmodule ? entry.nestedFiles ?? [] : []
  const nestedList = nestedFiles.length
    ? `<ul class="changed-files-list changed-files-list-nested">${nestedFiles
        .map((nestedEntry) => renderChangedFileItem(nestedEntry))
        .join('')}</ul>`
    : ''

  return (
    '<li class="changed-file-item">' +
    `<label class="changed-file-label">` +
    `<input type="checkbox" class="changed-file-toggle" data-changed-path="${escapeHtml(entry.path)}"${checked} />` +
    `<span class="changed-file-path" title="${escapeHtml(entry.path)}">${escapeHtml(entry.path)}</span>` +
    '</label>' +
    `<span>${renderGitStatusBadge(entry.status)}${stagedBadge}${conflictedBadge}${submoduleBadge}</span>` +
    nestedList +
    '</li>'
  )
}

const CHANGED_FILES_RENDER_LIMIT = 300

function renderChangedFilesSelection() {
  const files = state.workingTreeSnapshot?.files ?? []
  if (files.length === 0) {
    elements.changedFilesOutput.textContent = 'No changed files detected.'
    elements.changedFilesSelectAllButton.disabled = true
    elements.changedFilesSelectNoneButton.disabled = true
    return
  }

  // Rendering thousands of checkboxes (a freshly converted BIDS/PRISM
  // dataset can easily have 5000+ changed files) is real DOM/layout cost
  // for no practical benefit — nobody reviews that many rows one by one.
  // Select All/None still act on the full snapshot regardless of what's
  // rendered here, so capping the list is safe.
  const visibleFiles = files.slice(0, CHANGED_FILES_RENDER_LIMIT)
  const list = visibleFiles.map((entry) => renderChangedFileItem(entry)).join('')
  const truncationNote =
    files.length > CHANGED_FILES_RENDER_LIMIT
      ? `<p class="hint-inline">Showing the first ${CHANGED_FILES_RENDER_LIMIT} of ${files.length} changed files. ` +
        '"All" still selects every changed file for Save, not just the ones shown here.</p>'
      : ''

  elements.changedFilesOutput.innerHTML = truncationNote + `<ul class="changed-files-list">${list}</ul>`
  elements.changedFilesSelectAllButton.disabled = false
  elements.changedFilesSelectNoneButton.disabled = false
}

function renderRecentCommitList(overrideMessage = null) {
  if (overrideMessage) {
    elements.recentCommitsOutput.textContent = overrideMessage
    return
  }

  if (!state.recentCommits.length) {
    elements.recentCommitsOutput.textContent = 'No commits yet in this project.'
    return
  }

  const rows = state.recentCommits
    .map((entry) => {
      const age = formatAgeFromMilliseconds(Math.max(0, Date.now() - Number(entry.timestamp) * 1000))
      const hash = entry.commitHash || 'unknown'
      const subject = entry.subject || '(no subject)'
      const author = entry.author || 'Unknown author'

      return (
        '<li class="history-item">' +
        '<div class="history-item-head">' +
        `<span class="history-hash">${escapeHtml(hash)}</span>` +
        `<span class="history-age">${escapeHtml(age)} ago</span>` +
        '</div>' +
        `<div class="history-subject">${escapeHtml(subject)}</div>` +
        `<div class="history-author">${escapeHtml(author)}</div>` +
        '</li>'
      )
    })
    .join('')

  elements.recentCommitsOutput.innerHTML = `<ul class="history-list">${rows}</ul>`
}

function gatherSavePaths() {
  const selectedPaths = [...state.selectedChangedPaths]
  if (selectedPaths.length > 0) {
    return selectedPaths
  }

  return parsePaths(elements.paths.value)
}

function updateSaveButtonState() {
  const snapshot = state.workingTreeSnapshot

  const gating = computeSaveGating({
    hasMessage: Boolean(elements.message.value.trim()),
    hasSelection: gatherSavePaths().length > 0,
    hasConflicts: Boolean(snapshot?.conflictCount),
    hasChanges: Boolean(snapshot && !snapshot.clean)
  })

  elements.saveProjectButton.disabled = gating.disabled
  elements.saveGuidance.textContent = gating.guidance.text
  elements.saveGuidance.classList.toggle('hint-inline-warning', gating.guidance.warning)
}

async function ensureBranchActionSafety(projectPath, actionDescription) {
  const snapshot = await refreshWorkingTreeStatus(projectPath)
  if (!snapshot) {
    return false
  }

  if (snapshot.conflictCount > 0) {
    setBranchStatus('Resolve conflicts before changing branches.', 'error')
    setLastActionState('Resolve conflicts before branch actions.', 'error')
    elements.commandOutput.textContent = 'Branch action blocked because merge conflicts are present.'
    return false
  }

  if (snapshot.clean) {
    return true
  }

  const confirmText =
    `You have ${snapshot.totalChanged} unsaved file changes. ` +
    `It may be safer to save before you ${actionDescription}. Continue anyway?`

  const shouldProceed = window.confirm(confirmText)
  if (!shouldProceed) {
    setBranchStatus('Branch action canceled. Save work first, then retry.', 'idle')
    setLastActionState('Branch action canceled.', 'idle')
    return false
  }

  return true
}

async function buildSaveSummary(projectPath, savedPaths) {
  try {
    const commitMeta = await api.getLastCommit(projectPath)
    if (!commitMeta?.hasCommit) {
      return null
    }

    const fileSummary = savedPaths.length > 0 ? `${savedPaths.length} selected file(s)` : 'full dataset scope'
    const hashSummary = commitMeta.commitHash ? ` ${commitMeta.commitHash}` : ''
    return `Saved ${fileSummary}. Latest commit:${hashSummary}.`
  } catch {
    return null
  }
}

function renderCommandResult(result, summary = null) {
  const statusLine = buildWorkflowStatusLine(result)
  const warningCount = result.warnings?.length ?? 0

  let html = `<p><strong>${escapeHtml(statusLine)}</strong></p>`

  if (result.command && result.args) {
    html += `<p class="cmd-preview"><code>${escapeHtml(buildCroppedCmdLine(result.command, result.args))}</code></p>`
  }

  if (typeof result.durationMs === 'number') {
    html += `<p class="cmd-duration${result.durationMs >= 5000 ? ' cmd-duration-slow' : ''}">${escapeHtml(
      formatDurationSeconds(result.durationMs)
    )}</p>`
  }

  if (summary) {
    html += `<p>${escapeHtml(summary)}</p>`
  }

  if (warningCount > 0) {
    html +=
      '<p><strong>Advisories</strong> (non-fatal):</p>' +
      `<ul>${result.warnings
        .map((warning) => {
          const actionHint = warning.actionHint ? ` (Tip: ${escapeHtml(warning.actionHint)})` : ''
          return `<li>${escapeHtml(warning.message)}${actionHint}</li>`
        })
        .join('')}</ul>`
  }

  if (!result.ok && result.userError) {
    html +=
      `<p><strong>${escapeHtml(result.userError.title)}</strong></p>` +
      `<p>${escapeHtml(result.userError.message)}</p>`
  }

  html +=
    '<details>' +
    '<summary>Raw command result</summary>' +
    `<pre class="panel panel-code panel-inline-code">${escapeHtml(JSON.stringify(buildRawResultPreview(result), null, 2))}</pre>` +
    '</details>'

  return html
}

const RAW_RESULT_ARRAY_LIMIT = 50
const RAW_RESULT_TEXT_LIMIT = 4000

// Same problem as buildCroppedCmdLine, one level down: a save across
// thousands of files duplicates that huge arg list into `result.args`, and
// stdout/stderr from a big datalad run can run to hundreds of KB — even
// collapsed behind <details>, stringifying and inserting all of that into
// the DOM is real work the renderer has to do on every command. Cap the
// array/text fields actually shown, without touching the result object
// used elsewhere for gating/rendering.
function buildRawResultPreview(result) {
  const preview = { ...result }

  if (Array.isArray(preview.args) && preview.args.length > RAW_RESULT_ARRAY_LIMIT) {
    preview.args = [
      ...preview.args.slice(0, RAW_RESULT_ARRAY_LIMIT),
      `… (+${preview.args.length - RAW_RESULT_ARRAY_LIMIT} more)`
    ]
  }

  for (const field of ['stdout', 'stderr']) {
    if (typeof preview[field] === 'string' && preview[field].length > RAW_RESULT_TEXT_LIMIT) {
      preview[field] =
        `${preview[field].slice(0, RAW_RESULT_TEXT_LIMIT)}\n… (truncated, ${preview[field].length} chars total)`
    }
  }

  return preview
}

function buildWorkflowStatusLine(result) {
  if (!result.ok) {
    return 'Action could not be completed.'
  }

  if (result.commandName === 'cloneInstall') {
    return 'Project cloned successfully.'
  }

  if (result.commandName === 'createProject') {
    return 'New project created.'
  }

  if (result.commandName === 'save') {
    return 'Project changes saved.'
  }

  if (result.commandName === 'get') {
    return 'Requested data retrieval finished.'
  }

  if (result.commandName === 'update') {
    return 'Project update finished.'
  }

  if (result.commandName === 'push') {
    return 'Publish finished.'
  }

  if (result.commandName === 'createBranch') {
    return 'Branch created and checked out.'
  }

  if (result.commandName === 'switchBranch') {
    return 'Branch switched.'
  }

  return 'Action finished.'
}

function actionLabel(commandName) {
  if (commandName === 'cloneInstall') {
    return 'Clone'
  }

  if (commandName === 'createProject') {
    return 'Create Project'
  }

  if (commandName === 'save') {
    return 'Save'
  }

  if (commandName === 'get') {
    return 'Get Data'
  }

  if (commandName === 'update') {
    return 'Update'
  }

  if (commandName === 'push') {
    return 'Publish'
  }

  if (commandName === 'createBranch') {
    return 'Create Branch'
  }

  if (commandName === 'switchBranch') {
    return 'Switch Branch'
  }

  return 'Action'
}

function friendlyProjectTypeLabel(classification) {
  if (classification === 'git') {
    return 'Git project'
  }

  if (classification === 'dataset') {
    return 'DataLad project'
  }

  if (classification === 'superdataset') {
    return 'DataLad project with linked data'
  }

  return 'Project type unknown'
}

function friendlyProjectSummary(classification) {
  if (classification === 'git') {
    return 'This folder is a regular Git project. DataLad-specific structure was not detected.'
  }

  if (classification === 'dataset') {
    return 'This folder is a DataLad project and is ready for DataLad actions.'
  }

  if (classification === 'superdataset') {
    return 'This DataLad project contains linked child data folders.'
  }

  return 'We could not determine the project type.'
}

function renderProjectCheckOutput(result) {
  const badgeClass = `badge-${result.classification}`
  const label = friendlyProjectTypeLabel(result.classification)
  const summary = friendlyProjectSummary(result.classification)
  const detailsReason = result.reason ?? 'No additional details provided.'
  const datasetSource = result.classificationSource?.dataset ?? 'n/a'
  const subdatasetSource = result.classificationSource?.subdatasets ?? 'n/a'

  return (
    `<div><span class="badge ${badgeClass}">${escapeHtml(label)}</span></div>` +
    `<div style="margin-top: 8px;">${escapeHtml(summary)}</div>` +
    '<details style="margin-top: 8px;">' +
    '<summary>Technical details</summary>' +
    `<div style="margin-top: 8px;">${escapeHtml(detailsReason)}</div>` +
    `<div style="margin-top: 8px; font-family: var(--mono); font-size: 0.78rem; color: #51636a;">` +
    `checks: dataset=${escapeHtml(datasetSource)} | linked-data=${escapeHtml(subdatasetSource)}` +
    '</div>' +
    '</details>'
  )
}

function setCurrentProjectHeader(projectPath, classification) {
  elements.currentProjectPath.textContent = projectPath || 'No project selected'
  elements.currentProjectIcon.textContent = projectEmojiForPath(projectPath)
  elements.currentProjectTitleInput.value = projectTitleForPath(projectPath)
  elements.currentProjectTitleInput.placeholder = projectPath
    ? `${projectNameFromPath(projectPath)} (add a title)`
    : 'Add a project title'
  renderNestedDatasetInfo()
  setProjectBadge(classification)
  renderRecentProjects()
  void refreshLastCommitMeta(projectPath)
  setOnboardingExpanded(!projectPath)
  setProjectDependentSectionsVisible(Boolean(projectPath))

  // Clear the previous project's health snapshot (and re-render) *before*
  // kicking off the new fetch. Without this, other in-flight refreshes for
  // the new project (e.g. refreshWorkingTreeStatus) call renderProjectHealth()
  // as a side effect and would otherwise repaint the *previous* project's
  // remote/sync chips and button gating until the real fetch resolves.
  state.projectHealthSnapshot = null
  renderProjectHealth()
  void refreshProjectHealth(projectPath)
  applyDatasetGatedButtons(classification)
}

function applyDatasetGatedButtons(classification) {
  const gating = computeDatasetGating(classification)

  elements.getDataButton.disabled = gating.disabled
  elements.getDataButton.title = gating.title
}

function setOnboardingExpanded(expanded) {
  elements.onboardingGroup.classList.toggle('onboarding-collapsed', !expanded)
  elements.switchProjectButton.hidden = expanded
}

// Until a project is actually opened, only "Latest Projects" / "Open Project"
// (the onboarding group) should be visible — every other card reads as
// confusing noise for a project nobody has chosen yet.
function setProjectDependentSectionsVisible(visible) {
  elements.projectStrip.hidden = !visible
  elements.projectHealthCard.hidden = !visible
  elements.projectSetupZone.hidden = !visible
  if (!visible) {
    elements.projectSetupZone.removeAttribute('open')
  }
  elements.projectWorkspaceGrid.hidden = !visible
  elements.technicalDetailsAside.hidden = !visible
  updatePowerUserConsoleVisibility()
}

async function refreshProjectHealth(projectPath) {
  if (!projectPath) {
    state.projectHealthSnapshot = null
    state.pendingHealthFetch = null
    renderProjectHealth()
    return null
  }

  // Opening a project calls setCurrentProjectHeader (and therefore this)
  // more than once in quick succession for the same resolved path —
  // detectProjectType's initial call, then refreshDatasetList's follow-up
  // once the active dataset path is confirmed. Each call spawns several
  // real git subprocesses, so reuse an in-flight fetch for the same path
  // instead of paying for that twice and making project opens feel slow.
  if (state.pendingHealthFetch?.path === projectPath) {
    return state.pendingHealthFetch.promise
  }

  elements.projectHealthOutput.innerHTML = loadingPanelHtml(
    'Checking project health… this can take a moment for large projects.'
  )

  const requestToken = nextRequestToken('projectHealth')

  const promise = (async () => {
    try {
      const health = await api.getProjectHealth(projectPath)
      if (!isLatestRequestToken('projectHealth', requestToken)) {
        return health
      }

      state.projectHealthSnapshot = health
      renderProjectHealth()
      return health
    } catch (error) {
      if (!isLatestRequestToken('projectHealth', requestToken)) {
        return null
      }

      state.projectHealthSnapshot = null
      renderProjectHealth(`Could not read project health: ${String(error.message)}`)
      return null
    } finally {
      if (state.pendingHealthFetch?.path === projectPath) {
        state.pendingHealthFetch = null
      }
    }
  })()

  state.pendingHealthFetch = { path: projectPath, promise }
  return promise
}

function applyRemoteGatedButtons(health) {
  const gating = computeRemoteGating(health)

  elements.updateProjectButton.disabled = gating.update.disabled
  elements.updateProjectButton.title = gating.update.title
  elements.publishProjectButton.disabled = gating.publish.disabled
  elements.publishProjectButton.title = gating.publish.title
  elements.remoteInfo.hidden = gating.remoteInfo.hidden
  elements.remoteInfo.textContent = gating.remoteInfo.text
}

function renderProjectHealth(overrideMessage = null) {
  if (overrideMessage) {
    elements.projectHealthOutput.textContent = overrideMessage
    return
  }

  const health = state.projectHealthSnapshot
  applyRemoteGatedButtons(health)

  if (!health) {
    elements.projectHealthOutput.textContent = 'Select a project to see its save, sync, and data status.'
    return
  }

  const unsavedChip = chipHtml(computeSaveStatusChip(state.workingTreeSnapshot))
  const syncChip = chipHtml(computeSyncStatusChip(health))
  const missingChip = chipHtml(computeMissingContentChip(health))

  elements.projectHealthOutput.innerHTML =
    `<div class="project-health-grid">${unsavedChip}${syncChip}${missingChip}</div>`
}

function chipHtml(chip) {
  if (!chip) {
    return ''
  }

  const toneClass = chip.tone === 'neutral' ? '' : ` status-chip-${chip.tone}`
  return `<span class="status-chip${toneClass}">${escapeHtml(chip.label)}</span>`
}

function classificationForPath(projectPath) {
  if (!projectPath) {
    return 'unknown'
  }

  if (state.rootProjectPath && projectPath !== state.rootProjectPath) {
    return 'dataset'
  }

  return state.rootProjectClassification
}

function getCurrentBadgeType() {
  if (elements.currentProjectBadge.classList.contains('badge-git')) {
    return 'git'
  }

  if (elements.currentProjectBadge.classList.contains('badge-dataset')) {
    return 'dataset'
  }

  if (elements.currentProjectBadge.classList.contains('badge-superdataset')) {
    return 'superdataset'
  }

  return 'unknown'
}

function setProjectBadge(classification) {
  const next = classification ?? 'unknown'
  elements.currentProjectBadge.classList.remove(
    'badge-git',
    'badge-dataset',
    'badge-superdataset',
    'badge-unknown'
  )

  if (next === 'git') {
    elements.currentProjectBadge.classList.add('badge-git')
    elements.currentProjectBadge.textContent = 'Git'
    return
  }

  if (next === 'dataset') {
    elements.currentProjectBadge.classList.add('badge-dataset')
    elements.currentProjectBadge.textContent = 'DataLad'
    return
  }

  if (next === 'superdataset') {
    elements.currentProjectBadge.classList.add('badge-superdataset')
    elements.currentProjectBadge.textContent = 'DataLad + Links'
    return
  }

  elements.currentProjectBadge.classList.add('badge-unknown')
  elements.currentProjectBadge.textContent = 'Unknown'
}

const BUSY_LABEL_FILE_COUNT_THRESHOLD = 20

function setButtonBusy(button, busy, busyLabel = 'Working…') {
  if (!button) {
    return
  }

  if (busy) {
    if (!button.dataset.idleLabel) {
      button.dataset.idleLabel = button.textContent
    }
    button.disabled = true
    button.classList.add('is-busy')
    button.textContent = busyLabel
    return
  }

  button.classList.remove('is-busy')
  button.disabled = false
  if (button.dataset.idleLabel) {
    button.textContent = button.dataset.idleLabel
    delete button.dataset.idleLabel
  }
}

function setLastActionState(text, tone) {
  elements.lastActionState.classList.remove('state-idle', 'state-success', 'state-warning', 'state-error')

  if (tone === 'success') {
    elements.lastActionState.classList.add('state-success')
  } else if (tone === 'warning') {
    elements.lastActionState.classList.add('state-warning')
  } else if (tone === 'error') {
    elements.lastActionState.classList.add('state-error')
  } else {
    elements.lastActionState.classList.add('state-idle')
  }

  elements.lastActionState.textContent = text
}

function setBranchStatus(text, tone) {
  elements.branchStatus.classList.remove('branch-status-idle', 'branch-status-success', 'branch-status-error')

  if (tone === 'success') {
    elements.branchStatus.classList.add('branch-status-success')
  } else if (tone === 'error') {
    elements.branchStatus.classList.add('branch-status-error')
  } else {
    elements.branchStatus.classList.add('branch-status-idle')
  }

  elements.branchStatus.textContent = text
}


async function refreshLastCommitMeta(projectPath) {
  const nextToken = state.commitMetaRequestToken + 1
  state.commitMetaRequestToken = nextToken

  if (!projectPath) {
    setLastCommitMeta('Select a project to see last commit status.', 'idle')
    return
  }

  try {
    const lastCommit = await api.getLastCommit(projectPath)
    if (state.commitMetaRequestToken !== nextToken) {
      return
    }

    if (!lastCommit?.hasCommit) {
      if (lastCommit?.reason === 'no-commits') {
        setLastCommitMeta('No commits yet in this project.', 'alert')
        return
      }

      if (lastCommit?.reason === 'not-git') {
        setLastCommitMeta('Selected folder is not a git repository yet.', 'idle')
        return
      }

      setLastCommitMeta('Last commit status unavailable.', 'idle')
      return
    }

    const ageMs = Math.max(0, Date.now() - Number(lastCommit.timestamp) * 1000)
    const relativeAge = formatAgeFromMilliseconds(ageMs)
    const suffix = lastCommit.commitHash ? ` (${lastCommit.commitHash})` : ''
    const commitMessage = (lastCommit.message ?? '').trim()
    const commitSubject = (lastCommit.subject ?? '').trim()
    const tooltipSource = commitMessage || commitSubject
    const tooltip = tooltipSource ? `Last commit message:\n${tooltipSource}` : ''
    setLastCommitMeta(`Last commit ${relativeAge} ago${suffix}.`, 'reminder', tooltip)
  } catch {
    if (state.commitMetaRequestToken !== nextToken) {
      return
    }
    setLastCommitMeta('Last commit status unavailable.', 'idle')
  }
}

function setLastCommitMeta(text, tone, tooltip = '') {
  elements.lastCommitMeta.classList.remove(
    'hero-meta-idle',
    'hero-meta-reminder',
    'hero-meta-alert',
    'hero-meta-has-tooltip'
  )

  if (tone === 'reminder') {
    elements.lastCommitMeta.classList.add('hero-meta-reminder')
  } else if (tone === 'alert') {
    elements.lastCommitMeta.classList.add('hero-meta-alert')
  } else {
    elements.lastCommitMeta.classList.add('hero-meta-idle')
  }

  elements.lastCommitMeta.textContent = text

  if (tooltip) {
    elements.lastCommitMeta.classList.add('hero-meta-has-tooltip')
    elements.lastCommitMeta.setAttribute('title', tooltip)
    elements.lastCommitMeta.setAttribute('data-tooltip', tooltip)
    elements.lastCommitMeta.setAttribute('tabindex', '0')
    return
  }

  elements.lastCommitMeta.removeAttribute('title')
  elements.lastCommitMeta.removeAttribute('data-tooltip')
  elements.lastCommitMeta.removeAttribute('tabindex')
}

function formatAgeFromMilliseconds(ageMs) {
  if (ageMs < 60 * 1000) {
    return 'just now'
  }

  if (ageMs < 60 * 60 * 1000) {
    const minutes = Math.floor(ageMs / (60 * 1000))
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  }

  if (ageMs < DAY_IN_MS) {
    const hours = Math.floor(ageMs / (60 * 60 * 1000))
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  }

  if (ageMs < 7 * DAY_IN_MS) {
    const days = Math.floor(ageMs / DAY_IN_MS)
    return `${days} ${days === 1 ? 'day' : 'days'}`
  }

  const weeks = Math.floor(ageMs / (7 * DAY_IN_MS))
  return `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`
}

function buildQuickSaveMessage() {
  const now = new Date()
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-')
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  return `checkpoint ${date} ${time}`
}

function loadRecentProjects() {
  try {
    const raw = localStorage.getItem(RECENT_PROJECTS_STORAGE_KEY)
    const rawEmojis = localStorage.getItem(RECENT_PROJECT_EMOJIS_STORAGE_KEY)
    const rawTitles = localStorage.getItem(RECENT_PROJECT_TITLES_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    const parsedEmojis = rawEmojis ? JSON.parse(rawEmojis) : {}
    const parsedTitles = rawTitles ? JSON.parse(rawTitles) : {}
    state.recentProjects = sanitizeRecentProjects(parsed)
    state.recentProjectEmojiByPath = sanitizeRecentProjectEmojiMap(parsedEmojis)
    state.recentProjectTitleByPath = sanitizeRecentProjectTitleMap(parsedTitles)
  } catch {
    state.recentProjects = []
    state.recentProjectEmojiByPath = {}
    state.recentProjectTitleByPath = {}
  }

  for (const projectPath of state.recentProjects) {
    ensureProjectEmoji(projectPath)
  }

  persistRecentProjects()
  renderRecentProjects()
}

function persistRecentProjects() {
  try {
    localStorage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(state.recentProjects))
    localStorage.setItem(RECENT_PROJECT_EMOJIS_STORAGE_KEY, JSON.stringify(state.recentProjectEmojiByPath))
    localStorage.setItem(RECENT_PROJECT_TITLES_STORAGE_KEY, JSON.stringify(state.recentProjectTitleByPath))
  } catch {
    // Ignore storage errors (for example private mode restrictions).
  }
}

function sanitizeRecentProjects(candidate) {
  if (!Array.isArray(candidate)) {
    return []
  }

  const uniquePaths = []
  for (const entry of candidate) {
    if (typeof entry !== 'string') {
      continue
    }

    const normalizedEntry = entry.trim()
    if (!normalizedEntry || uniquePaths.includes(normalizedEntry)) {
      continue
    }

    uniquePaths.push(normalizedEntry)
    if (uniquePaths.length >= MAX_RECENT_PROJECTS) {
      break
    }
  }

  return uniquePaths
}

function sanitizeRecentProjectEmojiMap(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return {}
  }

  const safeMap = {}
  for (const [projectPath, emoji] of Object.entries(candidate)) {
    const normalizedPath = projectPath.trim()
    if (!normalizedPath || typeof emoji !== 'string') {
      continue
    }

    if (PROJECT_EMOJI_CHOICES.includes(emoji)) {
      safeMap[normalizedPath] = emoji
    }
  }

  return safeMap
}

function sanitizeRecentProjectTitleMap(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return {}
  }

  const safeMap = {}
  for (const [projectPath, title] of Object.entries(candidate)) {
    const normalizedPath = projectPath.trim()
    const trimmedTitle = typeof title === 'string' ? title.trim() : ''
    if (!normalizedPath || !trimmedTitle) {
      continue
    }

    safeMap[normalizedPath] = trimmedTitle.slice(0, 80)
  }

  return safeMap
}

function rememberRecentProject(projectPath) {
  const normalizedPath = projectPath?.trim()
  if (!normalizedPath) {
    return
  }

  ensureProjectEmoji(normalizedPath)

  state.recentProjects = [normalizedPath, ...state.recentProjects.filter((entry) => entry !== normalizedPath)].slice(
    0,
    MAX_RECENT_PROJECTS
  )

  persistRecentProjects()
  renderRecentProjects()
}

function renderRecentProjects() {
  const currentPath = elements.projectPath.value.trim()

  if (state.recentProjects.length === 0) {
    elements.recentProjectsOutput.innerHTML =
      '<p class="hint-inline">No recent projects yet — opened projects will appear here.</p>'
    elements.clearRecentProjectsButton.disabled = true
    return
  }

  const slots = state.recentProjects.map((projectPath) => {
    const displayName = projectTitleForPath(projectPath) || projectNameFromPath(projectPath)
    const iconEmoji = projectEmojiForPath(projectPath)
    const isActive = projectPath === currentPath
    return (
      '<button type="button" class="recent-project-slot' +
      `${isActive ? ' recent-project-slot-active' : ''}" ` +
      `data-recent-project-path="${escapeHtml(projectPath)}" title="${escapeHtml(projectPath)}">` +
      `<span class="recent-project-icon" aria-hidden="true">${escapeHtml(iconEmoji)}</span>` +
      `<span class="recent-project-name">${escapeHtml(displayName)}</span>` +
      '</button>'
    )
  })

  elements.recentProjectsOutput.innerHTML = `<div class="recent-projects-line">${slots.join('')}</div>`
  elements.clearRecentProjectsButton.disabled = false
}

function projectNameFromPath(projectPath) {
  const normalized = String(projectPath).replaceAll('\\', '/').replace(/\/+$/, '')
  const segments = normalized.split('/').filter(Boolean)
  return segments.at(-1) ?? normalized
}

function projectEmojiForPath(projectPath) {
  const normalizedPath = projectPath?.trim()
  if (!normalizedPath) {
    return '📁'
  }

  return state.recentProjectEmojiByPath[normalizedPath] ?? ensureProjectEmoji(normalizedPath)
}

function ensureProjectEmoji(projectPath) {
  const normalizedPath = projectPath?.trim()
  if (!normalizedPath) {
    return '📁'
  }

  const existing = state.recentProjectEmojiByPath[normalizedPath]
  if (existing) {
    return existing
  }

  const usedEmojis = new Set(Object.values(state.recentProjectEmojiByPath))
  const availablePool = PROJECT_EMOJI_CHOICES.filter((emoji) => !usedEmojis.has(emoji))
  const selectionPool = availablePool.length ? availablePool : PROJECT_EMOJI_CHOICES
  const selectedEmoji = selectionPool[Math.floor(Math.random() * selectionPool.length)]
  state.recentProjectEmojiByPath[normalizedPath] = selectedEmoji
  return selectedEmoji
}

function projectTitleForPath(projectPath) {
  const normalizedPath = projectPath?.trim()
  if (!normalizedPath) {
    return ''
  }

  return state.recentProjectTitleByPath[normalizedPath] ?? ''
}

function setProjectTitleForPath(projectPath, title) {
  const normalizedPath = projectPath?.trim()
  if (!normalizedPath) {
    return
  }

  const trimmedTitle = title.trim()
  if (trimmedTitle) {
    state.recentProjectTitleByPath[normalizedPath] = trimmedTitle
  } else {
    delete state.recentProjectTitleByPath[normalizedPath]
  }

  persistRecentProjects()
}

function renderNestedDatasetInfo() {
  const nestedCount = (state.datasets ?? []).filter((dataset) => dataset.relativePath !== '.').length

  if (!state.rootProjectPath || nestedCount === 0) {
    elements.currentProjectNestedInfo.hidden = true
    elements.currentProjectNestedInfo.textContent = ''
    return
  }

  elements.currentProjectNestedInfo.hidden = false
  elements.currentProjectNestedInfo.textContent =
    nestedCount === 1 ? 'Contains 1 nested dataset' : `Contains ${nestedCount} nested datasets`
}

elements.currentProjectTitleInput.addEventListener('input', () => {
  setProjectTitleForPath(state.rootProjectPath, elements.currentProjectTitleInput.value)
  renderRecentProjects()
})

function initPowerUserConsole() {
  let powerUserModeEnabled = false
  try {
    powerUserModeEnabled = localStorage.getItem(POWER_USER_MODE_STORAGE_KEY) === '1'
  } catch {
    powerUserModeEnabled = false
  }

  elements.powerUserModeToggle.checked = powerUserModeEnabled
  updatePowerUserConsoleVisibility()
  elements.consoleProjectPath.value = elements.commandProjectPath.value
  elements.consoleHelpText.innerHTML =
    api.platform === 'win32'
      ? 'Run any command directly against the active project folder, for anything the buttons above don’t ' +
        'cover. This runs through the same shell as a normal Windows terminal, so <code>&amp;</code>, ' +
        '<code>|</code>, <code>%VAR%</code>, and <code>.cmd</code>/<code>.bat</code> tools (<code>npm</code>, ' +
        '<code>npx</code>, <code>yarn</code>, ...) all work as expected. There is no allowlist or safety net, ' +
        'so be as careful as you would be in a real terminal.'
      : 'Run any command directly against the active project folder, for anything the buttons above don’t ' +
        'cover — <code>datalad</code>, <code>git</code>, <code>git-annex</code>, or any other tool on your ' +
        'system. Each run is a single process with no shell (no <code>&amp;&amp;</code>, pipes, or ' +
        '<code>cd</code>), so shell operators are treated as literal text rather than executed.'

  elements.powerUserModeToggle.addEventListener('change', () => {
    const enabled = elements.powerUserModeToggle.checked
    updatePowerUserConsoleVisibility()
    try {
      localStorage.setItem(POWER_USER_MODE_STORAGE_KEY, enabled ? '1' : '0')
    } catch {
      // Ignore storage errors (for example private mode restrictions).
    }
  })

  elements.commandProjectPath.addEventListener('input', () => {
    elements.consoleProjectPath.value = elements.commandProjectPath.value
  })

  elements.consoleRunButton.addEventListener('click', runConsoleCommand)
  elements.consoleHistoryOutput.addEventListener('click', (event) => {
    const target = event.target.closest('[data-console-history-index]')
    if (!target) {
      return
    }

    const index = Number(target.getAttribute('data-console-history-index'))
    const entry = state.consoleHistory[index]
    if (!entry) {
      return
    }

    elements.consoleCommand.value = entry.commandText
  })
}

function updatePowerUserConsoleVisibility() {
  const visible = elements.powerUserModeToggle.checked && Boolean(elements.commandProjectPath.value.trim())
  elements.powerUserConsole.hidden = !visible
  if (!visible) {
    elements.powerUserConsole.removeAttribute('open')
  }
}

async function runConsoleCommand() {
  const projectPath = elements.commandProjectPath.value.trim()
  if (!projectPath) {
    elements.consoleOutput.textContent = 'Choose a project above before running a console command.'
    return
  }

  const commandText = elements.consoleCommand.value.trim()
  if (!commandText) {
    elements.consoleOutput.textContent = 'Enter a command to run.'
    return
  }

  elements.consoleRunButton.disabled = true
  elements.consoleOutput.textContent = `$ ${commandText}\n\nRunning...`

  try {
    const result = await api.runConsoleCommand({ commandText, projectPath })
    elements.consoleOutput.textContent = renderConsoleResult(commandText, result)
    rememberConsoleCommand(commandText)
  } catch (error) {
    elements.consoleOutput.textContent = `$ ${commandText}\n\nFailed to run command: ${error?.message ?? String(error)}`
  } finally {
    elements.consoleRunButton.disabled = false
  }
}

function renderConsoleResult(commandText, result) {
  const statusLine = result.failed ? `Failed (exit ${result.exitCode})` : `Succeeded (exit ${result.exitCode})`
  const sections = [`$ ${commandText}`, '', statusLine]

  if (result.stdout) {
    sections.push('', result.stdout.trimEnd())
  }

  if (result.stderr) {
    sections.push('', 'stderr:', result.stderr.trimEnd())
  }

  return sections.join('\n')
}

function rememberConsoleCommand(commandText) {
  state.consoleHistory.unshift({ commandText, ranAt: Date.now() })
  state.consoleHistory.length = Math.min(state.consoleHistory.length, MAX_CONSOLE_HISTORY)
  renderConsoleHistory()
}

function renderConsoleHistory() {
  if (state.consoleHistory.length === 0) {
    elements.consoleHistoryOutput.textContent = 'No commands run yet this session.'
    return
  }

  elements.consoleHistoryOutput.innerHTML = state.consoleHistory
    .map(
      (entry, index) =>
        `<button type="button" class="button button-ghost button-inline console-history-item" data-console-history-index="${index}">` +
        `${escapeHtml(entry.commandText)}` +
        '</button>'
    )
    .join('')
}

function renderFileListing(listing, query) {
  const normalizedQuery = query.trim().toLowerCase()
  const filteredEntries = normalizedQuery
    ? listing.entries.filter((entry) => entry.relativePath.toLowerCase().includes(normalizedQuery))
    : listing.entries

  if (!filteredEntries.length) {
    return '<p>No matching files or folders.</p>'
  }

  const tree = buildFileTree(listing.rootPath, filteredEntries)
  const treeHtml = renderFileTreeNodes(tree.children, Boolean(normalizedQuery), 0)
  const finderHeader =
    '<div class="finder-header"><span>Item</span><span class="finder-header-action">Reveal</span></div>'
  const truncatedNote = listing.truncated
    ? '<p class="hint">Listing truncated. Narrow project scope or increase listing limits.</p>'
    : ''

  return `<p class="hint">Finder-style view: expand folders, click Open to reveal in file manager, and watch status badges for changed items.</p>${finderHeader}${treeHtml}${truncatedNote}`
}

function buildFileTree(rootPath, entries) {
  const root = {
    name: '.',
    type: 'directory',
    absolutePath: rootPath,
    gitStatus: null,
    children: new Map()
  }
  const metadataByRelative = new Map(
    entries.map((entry) => [
      entry.relativePath,
      {
        absolutePath: entry.absolutePath,
        gitStatus: entry.gitStatus ?? null,
        annexPresent: entry.annexPresent ?? null
      }
    ])
  )

  for (const entry of entries) {
    const segments = entry.relativePath.split('/').filter(Boolean)
    let currentNode = root
    let currentRelativePath = ''

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]
      const isLeaf = index === segments.length - 1
      currentRelativePath = currentRelativePath ? `${currentRelativePath}/${segment}` : segment

      if (!currentNode.children.has(segment)) {
        const pathMetadata = isLeaf
          ? {
              absolutePath: entry.absolutePath,
              gitStatus: entry.gitStatus ?? null,
              annexPresent: entry.annexPresent ?? null
            }
          : metadataByRelative.get(currentRelativePath) ?? {
              absolutePath: null,
              gitStatus: null,
              annexPresent: null
            }

        currentNode.children.set(segment, {
          name: segment,
          type: isLeaf ? entry.type : 'directory',
          absolutePath: pathMetadata.absolutePath,
          gitStatus: pathMetadata.gitStatus,
          annexPresent: pathMetadata.annexPresent,
          children: new Map()
        })
      }

      const nextNode = currentNode.children.get(segment)
      if (isLeaf && !nextNode.absolutePath) {
        nextNode.absolutePath = entry.absolutePath
      }

      if (isLeaf && !nextNode.gitStatus) {
        nextNode.gitStatus = entry.gitStatus ?? null
      }

      if (isLeaf && nextNode.annexPresent === null) {
        nextNode.annexPresent = entry.annexPresent ?? null
      }

      if (!isLeaf) {
        nextNode.type = 'directory'
        const dirMeta = metadataByRelative.get(currentRelativePath)
        if (dirMeta?.gitStatus) {
          nextNode.gitStatus = dirMeta.gitStatus
        }
        if (dirMeta?.annexPresent !== undefined && nextNode.annexPresent === null) {
          nextNode.annexPresent = dirMeta.annexPresent ?? null
        }
      }
      currentNode = nextNode
    }
  }

  return root
}

function renderFileTreeNodes(children, expandAll, depth) {
  const nodes = [...children.values()].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'directory' ? -1 : 1
    }
    return left.name.localeCompare(right.name)
  })

  const items = nodes
    .map((node) => {
      const openButton = node.absolutePath
        ? `<button type="button" class="button button-ghost button-mini" data-entry-path="${escapeHtml(node.absolutePath)}">Open</button>`
        : ''
      const iconClass = node.type === 'directory' ? 'file-icon file-icon-folder' : 'file-icon file-icon-file'
      const statusBadge = renderGitStatusBadge(node.gitStatus)
      const annexBadge = renderAnnexBadge(node.annexPresent)
      const label =
        `<span class="finder-name-cell"><span class="${iconClass}" aria-hidden="true"></span>` +
        `<span class="file-name">${escapeHtml(node.name)}</span>${statusBadge}${annexBadge}</span>`

      if (node.type === 'directory') {
        const openAttribute = expandAll || depth === 0 ? ' open' : ''
        return (
          '<li class="file-node folder-node">' +
          `<details${openAttribute}>` +
          '<summary class="finder-row finder-row-folder">' +
          label +
          `<span class="finder-action-cell">${openButton}</span>` +
          '</summary>' +
          renderFileTreeNodes(node.children, expandAll, depth + 1) +
          '</details>' +
          '</li>'
        )
      }

      return (
        '<li class="file-node file-row finder-row">' +
        label +
        `<span class="finder-action-cell">${openButton}</span>` +
        '</li>'
      )
    })
    .join('')

  return `<ul class="file-list depth-${depth}">${items}</ul>`
}

function renderGitStatusBadge(gitStatus) {
  if (!gitStatus) {
    return ''
  }

  const labels = {
    modified: 'Modified',
    added: 'Added',
    deleted: 'Deleted',
    renamed: 'Renamed',
    untracked: 'Untracked',
    conflict: 'Conflict',
    changed: 'Changed'
  }

  const label = labels[gitStatus] ?? 'Changed'
  return `<span class="file-status file-status-${escapeHtml(gitStatus)}">${escapeHtml(label)}</span>`
}

function renderAnnexBadge(annexPresent) {
  if (annexPresent === true) {
    return '<span class="file-status file-status-local">Local</span>'
  }
  if (annexPresent === 'partial') {
    return '<span class="file-status file-status-partial">Partial</span>'
  }
  return ''
}

const CMD_PREVIEW_PATH_ARG_LIMIT = 8
const CMD_PREVIEW_CHAR_LIMIT = 600

// Large operations (saving thousands of files from a huge dataset, etc.)
// pass huge argument lists — showing them all turns this panel into an
// unreadable wall of text. Preview the command/flags plus a handful of
// path args and summarize the rest; the full argument list is still
// available below in "Raw command result" for anyone who needs it.
function buildCroppedCmdLine(command, args) {
  const fullLine = [command, ...args].join(' ')
  if (fullLine.length <= CMD_PREVIEW_CHAR_LIMIT) {
    return fullLine
  }

  const separatorIndex = args.indexOf('--')
  const flagArgs = separatorIndex === -1 ? [] : args.slice(0, separatorIndex + 1)
  const pathArgs = separatorIndex === -1 ? [] : args.slice(separatorIndex + 1)

  if (pathArgs.length > CMD_PREVIEW_PATH_ARG_LIMIT) {
    const shown = pathArgs.slice(0, CMD_PREVIEW_PATH_ARG_LIMIT)
    const remaining = pathArgs.length - shown.length
    return `${[command, ...flagArgs, ...shown].join(' ')} … (+${remaining} more file${remaining === 1 ? '' : 's'})`
  }

  return `${fullLine.slice(0, CMD_PREVIEW_CHAR_LIMIT)}…`
}

function formatDurationSeconds(durationMs) {
  const seconds = durationMs / 1000
  return `Command finished in ${seconds >= 10 ? Math.round(seconds) : seconds.toFixed(1)}s.`
}

function loadingPanelHtml(message) {
  return `<p>${escapeHtml(message)}</p><div class="loading-bar" role="progressbar" aria-label="${escapeHtml(
    message
  )}"></div>`
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function nextRequestToken(key) {
  const nextToken = (state.requestTokens[key] ?? 0) + 1
  state.requestTokens[key] = nextToken
  return nextToken
}

function isLatestRequestToken(key, token) {
  return state.requestTokens[key] === token
}