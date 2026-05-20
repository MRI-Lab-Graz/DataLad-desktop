const TOOL_LABELS = {
  python: 'Python 3',
  datalad: 'DataLad',
  gitAnnex: 'git-annex'
}

const RECOVERY_BY_ISSUE = {
  PYTHON_MISSING:
    'Install Python 3 and ensure one of these commands is available in PATH: python3, python, or py -3 (Windows).',
  DATALAD_MISSING: 'Install DataLad and confirm the datalad command works in your shell.',
  GIT_ANNEX_MISSING: 'Install git-annex and ensure it is available to your Git installation.'
}

/**
 * Build a UI-ready diagnostics summary for onboarding and recovery banners.
 */
export function formatEnvironmentDiagnostics(diagnostics) {
  const checks = [
    formatCheck('python', diagnostics.python),
    formatCheck('datalad', diagnostics.datalad),
    formatCheck('gitAnnex', diagnostics.gitAnnex)
  ]

  const recoverySteps = diagnostics.issues
    .map((issue) => RECOVERY_BY_ISSUE[issue.code])
    .filter(Boolean)

  const dedupedSteps = [...new Set(recoverySteps)]

  return {
    severity: diagnostics.supported ? 'info' : 'warning',
    headline: diagnostics.supported
      ? 'DataLad environment is ready'
      : 'DataLad setup needs attention',
    summary: diagnostics.supported
      ? 'All required tools are available. You can continue with DataLad project actions.'
      : 'One or more required tools are missing. Resolve the items below before using DataLad actions.',
    checks,
    recoverySteps: dedupedSteps
  }
}

function formatCheck(toolName, toolStatus) {
  return {
    tool: toolName,
    label: TOOL_LABELS[toolName] ?? toolName,
    status: toolStatus.available ? 'ok' : 'missing',
    version: toolStatus.version,
    details: toolStatus.details
  }
}