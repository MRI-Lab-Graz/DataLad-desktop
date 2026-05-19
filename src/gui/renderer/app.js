const api = window.dataladDesktop

const elements = {
  projectPath: document.getElementById('project-path'),
  commandProjectPath: document.getElementById('command-project-path'),
  commandName: document.getElementById('command-name'),
  source: document.getElementById('source'),
  targetPath: document.getElementById('target-path'),
  message: document.getElementById('message'),
  paths: document.getElementById('paths'),
  checkEnvButton: document.getElementById('check-env'),
  detectProjectButton: document.getElementById('detect-project'),
  runCommandButton: document.getElementById('run-command'),
  refreshContractButton: document.getElementById('refresh-contract'),
  environmentOutput: document.getElementById('environment-output'),
  classificationOutput: document.getElementById('classification-output'),
  commandOutput: document.getElementById('command-output'),
  contractOutput: document.getElementById('contract-output')
}

await seedWorkspacePath()
toggleFieldsByCommand(elements.commandName.value)
await renderContract()

elements.commandName.addEventListener('change', () => {
  toggleFieldsByCommand(elements.commandName.value)
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
    return
  }

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
  } catch (error) {
    elements.classificationOutput.textContent = String(error.message)
  }
})

elements.runCommandButton.addEventListener('click', async () => {
  const commandName = elements.commandName.value
  const request = buildCommandRequest(commandName)

  try {
    const result = await api.runCommand(commandName, request)
    elements.commandOutput.textContent = JSON.stringify(result, null, 2)
  } catch (error) {
    elements.commandOutput.textContent = String(error.message)
  }
})

elements.refreshContractButton.addEventListener('click', async () => {
  await renderContract()
})

function buildCommandRequest(commandName) {
  switch (commandName) {
    case 'cloneInstall':
      return {
        source: elements.source.value.trim(),
        targetPath: elements.targetPath.value.trim()
      }
    case 'save':
      return {
        projectPath: elements.commandProjectPath.value.trim(),
        message: elements.message.value.trim(),
        paths: parsePaths(elements.paths.value)
      }
    case 'get':
      return {
        projectPath: elements.commandProjectPath.value.trim(),
        paths: parsePaths(elements.paths.value)
      }
    case 'update':
    case 'push':
      return {
        projectPath: elements.commandProjectPath.value.trim()
      }
    default:
      return {}
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

function toggleFieldsByCommand(commandName) {
  setFieldVisibility('source', commandName === 'cloneInstall')
  setFieldVisibility('targetPath', commandName === 'cloneInstall')
  setFieldVisibility('projectPath', commandName !== 'cloneInstall')
  setFieldVisibility('message', commandName === 'save')
  setFieldVisibility('paths', commandName === 'save' || commandName === 'get')
}

function setFieldVisibility(fieldName, visible) {
  const node = document.querySelector(`[data-field="${fieldName}"]`)
  if (!node) {
    return
  }
  node.hidden = !visible
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

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}