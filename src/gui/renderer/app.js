const api = window.dataladDesktop

const elements = {
  projectPath: document.getElementById('project-path'),
  pickProjectPathButton: document.getElementById('pick-project-path'),
  commandProjectPath: document.getElementById('command-project-path'),
  pickCommandProjectPathButton: document.getElementById('pick-command-project-path'),
  currentProjectPath: document.getElementById('current-project-path'),
  currentProjectBadge: document.getElementById('current-project-badge'),
  lastActionState: document.getElementById('last-action-state'),
  source: document.getElementById('source'),
  targetPath: document.getElementById('target-path'),
  pickTargetPathButton: document.getElementById('pick-target-path'),
  cloneProjectButton: document.getElementById('clone-project'),
  saveProjectButton: document.getElementById('save-project'),
  getDataButton: document.getElementById('get-data'),
  updateProjectButton: document.getElementById('update-project'),
  publishProjectButton: document.getElementById('publish-project'),
  message: document.getElementById('message'),
  paths: document.getElementById('paths'),
  checkEnvButton: document.getElementById('check-env'),
  detectProjectButton: document.getElementById('detect-project'),
  refreshContractButton: document.getElementById('refresh-contract'),
  environmentOutput: document.getElementById('environment-output'),
  classificationOutput: document.getElementById('classification-output'),
  commandOutput: document.getElementById('command-output'),
  contractOutput: document.getElementById('contract-output')
}

await seedWorkspacePath()
await renderContract()
setCurrentProjectHeader(elements.commandProjectPath.value.trim(), 'unknown')

wireFolderPicker(elements.pickProjectPathButton, elements.projectPath, {
  title: 'Select project folder',
  mirrorTo: elements.commandProjectPath,
  setAsCurrentProject: true
})

wireFolderPicker(elements.pickCommandProjectPathButton, elements.commandProjectPath, {
  title: 'Select command project folder',
  setAsCurrentProject: true
})

wireFolderPicker(elements.pickTargetPathButton, elements.targetPath, {
  title: 'Select clone target folder'
})

elements.checkEnvButton.addEventListener('click', async () => {
  try {
    const diagnostics = await api.checkEnvironment()
    elements.environmentOutput.innerHTML = renderEnvironment(diagnostics)
  } catch (error) {
    elements.environmentOutput.textContent = String(error.message)
  }
})

elements.detectProjectButton.addEventListener('click', async () => {
  const projectPath = elements.projectPath.value.trim()
  if (!projectPath) {
    elements.classificationOutput.textContent = 'Enter a project path first.'
    setLastActionState('Select a project folder first.', 'error')
    return
  }

  await detectProjectType(projectPath)
})

elements.cloneProjectButton.addEventListener('click', async () => {
  const source = elements.source.value.trim()
  const targetPath = elements.targetPath.value.trim()

  if (!source || !targetPath) {
    elements.commandOutput.textContent = 'Provide both source URL and target folder for clone.'
    setLastActionState('Add source URL and target folder.', 'error')
    return
  }

  const cloneResult = await runWorkflowCommand('cloneInstall', { source, targetPath })
  if (!cloneResult?.ok) {
    return
  }

  elements.commandProjectPath.value = targetPath
  elements.projectPath.value = targetPath
  setCurrentProjectHeader(targetPath, 'unknown')
  await detectProjectType(targetPath)
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
    return
  }

  await runWorkflowCommand('save', {
    projectPath,
    message,
    paths: parsePaths(elements.paths.value)
  })
})

elements.getDataButton.addEventListener('click', async () => {
  const projectPath = readProjectPath()
  if (!projectPath) {
    return
  }

  await runWorkflowCommand('get', {
    projectPath,
    paths: parsePaths(elements.paths.value)
  })
})

elements.updateProjectButton.addEventListener('click', async () => {
  const projectPath = readProjectPath()
  if (!projectPath) {
    return
  }

  await runWorkflowCommand('update', { projectPath })
})

elements.publishProjectButton.addEventListener('click', async () => {
  const projectPath = readProjectPath()
  if (!projectPath) {
    return
  }

  await runWorkflowCommand('push', { projectPath })
})

elements.refreshContractButton.addEventListener('click', async () => {
  await renderContract()
})

async function detectProjectType(projectPath) {
  try {
    const result = await api.detectProject(projectPath)
    const badgeClass = `badge-${result.classification}`
    elements.classificationOutput.innerHTML =
      `<div><span class="badge ${badgeClass}">${escapeHtml(result.classification)}</span></div>` +
      `<div style="margin-top: 8px;">${escapeHtml(result.reason ?? 'No details provided.')}</div>` +
      `<div style="margin-top: 8px; font-family: var(--mono); font-size: 0.78rem; color: #51636a;">` +
      `dataset probe: ${escapeHtml(result.classificationSource?.dataset ?? 'n/a')} | ` +
      `subdataset probe: ${escapeHtml(result.classificationSource?.subdatasets ?? 'n/a')}` +
      `</div>`
    setCurrentProjectHeader(projectPath, result.classification)
    setLastActionState(`Project type detected: ${result.classification}.`, 'success')
  } catch (error) {
    elements.classificationOutput.textContent = String(error.message)
    setLastActionState('Project type detection failed.', 'error')
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

async function runWorkflowCommand(commandName, request) {
  try {
    const result = await api.runCommand(commandName, request)
    elements.commandOutput.innerHTML = renderCommandResult(result)
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
  }
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
    const selectedPath = await api.pickDirectory({
      title: options.title,
      defaultPath: input.value.trim()
    })

    if (!selectedPath) {
      return
    }

    input.value = selectedPath
    if (options.mirrorTo) {
      options.mirrorTo.value = selectedPath
    }

    if (options.setAsCurrentProject) {
      setCurrentProjectHeader(selectedPath, getCurrentBadgeType())
    }
  })
}

async function seedWorkspacePath() {
  try {
    const workspaceRoot = await api.getWorkspaceRoot()
    elements.projectPath.value = workspaceRoot
    elements.commandProjectPath.value = workspaceRoot
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

function renderCommandResult(result) {
  const statusLine = buildWorkflowStatusLine(result)
  const warningCount = result.warnings?.length ?? 0

  let html = `<p><strong>${escapeHtml(statusLine)}</strong></p>`

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
    `<pre class="panel panel-code panel-inline-code">${escapeHtml(JSON.stringify(result, null, 2))}</pre>` +
    '</details>'

  return html
}

function buildWorkflowStatusLine(result) {
  if (!result.ok) {
    return 'Action could not be completed.'
  }

  if (result.commandName === 'cloneInstall') {
    return 'Project cloned successfully.'
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

  return 'Action finished.'
}

function actionLabel(commandName) {
  if (commandName === 'cloneInstall') {
    return 'Clone'
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

  return 'Action'
}

function setCurrentProjectHeader(projectPath, classification) {
  elements.currentProjectPath.textContent = projectPath || 'No project selected'
  setProjectBadge(classification)
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
    elements.currentProjectBadge.textContent = 'Dataset'
    return
  }

  if (next === 'superdataset') {
    elements.currentProjectBadge.classList.add('badge-superdataset')
    elements.currentProjectBadge.textContent = 'Superdataset'
    return
  }

  elements.currentProjectBadge.classList.add('badge-unknown')
  elements.currentProjectBadge.textContent = 'Unknown'
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

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}