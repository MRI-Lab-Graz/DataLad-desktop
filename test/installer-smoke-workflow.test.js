import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const workflow = await readFile(
  new URL('../.github/workflows/installer-smoke.yml', import.meta.url),
  'utf8'
)

// The installer downloads from third-party hosts (kitenet, python.org, github),
// so it must not run on every push: manual dispatch and release tags only.
test('runs only on manual dispatch and v* release tags', () => {
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /tags:\s*\n\s*- 'v\*'/)
  assert.doesNotMatch(workflow, /branches:/)
  assert.doesNotMatch(workflow, /pull_request:/)
})

// Pre-installing DataLad/git-annex would hide the installer doing its job.
test('starts from a runner without DataLad or git-annex pre-installed', () => {
  assert.match(workflow, /runs-on: windows-latest/)
  assert.doesNotMatch(workflow, /datalad-installer/)
  assert.doesNotMatch(workflow, /pip install/)
})

test('builds the NSIS installer, installs it silently, checks the tools, drives the installed app, then uninstalls', () => {
  const order = [
    'electron-builder --win nsis',
    "'/S'",
    'git annex version',
    'e2e/installed-env.e2e.mjs',
    'Uninstall DataLad Desktop.exe'
  ].map((needle) => {
    const at = workflow.indexOf(needle)
    assert.ok(at !== -1, `missing: ${needle}`)
    return at
  })
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'steps out of order')
  assert.match(workflow, /DLAD_APP_EXECUTABLE: C:\\Program Files\\DataLad Desktop\\DataLad Desktop\.exe/)
})

// The installer's silent mode prints nothing, so on failure CI must show where
// Python and DataLad actually ended up.
test('dumps Python/DataLad diagnostics when a step fails', () => {
  const step = workflow.split('- name:').find((s) => s.includes('if: failure()'))
  assert.ok(step, 'expected a step gated on failure()')
  for (const needle of ['py -0p', 'datalad-env', 'Get-Command']) {
    assert.ok(step.includes(needle), `diagnostics step should run: ${needle}`)
  }
})

// The installer must leave DataLad in its private env and the uninstaller must take it away again.
test('proves datalad comes from the private env and that uninstall removes it', () => {
  assert.match(workflow, /\(Get-Command datalad\)\.Source/)
  assert.match(workflow, /datalad-env\\Scripts/)
  assert.match(workflow, /Test-Path "\$dir\\datalad-env"/)
})

test('prints the installer log when a step fails', () => {
  const step = workflow.split('- name:').find((s) => s.includes('if: failure()'))
  assert.match(step, /install\.log/)
})
