import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const workflow = await readFile(new URL('../.github/workflows/install-script-smoke.yml', import.meta.url), 'utf8')

// Like installer-smoke: it downloads git-annex from a third-party mirror, so it must not gate every push.
test('runs only on manual dispatch and v* release tags', () => {
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /tags:\s*\n\s*- 'v\*'/)
  assert.doesNotMatch(workflow, /branches:/)
  assert.doesNotMatch(workflow, /pull_request:/)
})

// Pre-installing DataLad or git-annex would hide the script doing its job.
test('starts from a runner without DataLad or git-annex pre-installed', () => {
  assert.match(workflow, /runs-on: windows-latest/)
  assert.doesNotMatch(workflow, /datalad-installer/)
  assert.doesNotMatch(workflow, /pip install/)
})

test('builds the unpacked app, zips and renders it like the release job, then runs install.cmd -FromDir', () => {
  const order = [
    'node scripts/fetch-uv.mjs x86_64-pc-windows-msvc',
    'electron-builder --win dir',
    'Compress-Archive -Path',
    'node scripts/render-install-script.mjs',
    'install.cmd -FromDir'
  ]
  let at = -1
  for (const step of order) {
    const next = workflow.indexOf(step, at + 1)
    assert.ok(next > at, `expected "${step}" after the previous step`)
    at = next
  }
})

test('the install runs without waiting for a key at the end', () => {
  assert.match(workflow, /install\.cmd -FromDir [^\n]*< NUL/)
})

test('proves git, DataLad and git-annex work and that datalad comes from the private env under LocalAppData', () => {
  assert.match(workflow, /git --version/)
  assert.match(workflow, /datalad --version/)
  assert.match(workflow, /git annex version/)
  assert.match(workflow, /datalad-env\\Scripts/)
  assert.match(workflow, /LOCALAPPDATA/)
})

test('drives the installed app', () => {
  assert.match(workflow, /DLAD_APP_EXECUTABLE/)
  assert.match(workflow, /node --test e2e\/packaged\.e2e\.mjs/)
})

test('checks the pins against what the hosts serve today', () => {
  assert.match(workflow, /node scripts\/check-install-pins\.mjs/)
})

test('uninstalls through uninstall.cmd and checks the folder, shortcuts and user PATH are clean', () => {
  const uninstall = workflow.indexOf('uninstall.cmd')
  assert.ok(uninstall > workflow.indexOf('check-install-pins'))
  assert.match(workflow, /DataLad Desktop\.lnk/)
  assert.match(workflow, /GetEnvironmentVariable\('Path', 'User'\)/)
})

test('prints the install log when a step fails', () => {
  assert.match(workflow, /if: failure\(\)/)
  assert.match(workflow, /DataLad Desktop install\.log/)
})

test('keeps read-only permissions', () => {
  assert.match(workflow, /permissions:\s*\n\s*contents: read/)
})
