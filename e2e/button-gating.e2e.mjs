// Real-Electron smoke tests for the workflow button gating fixed in this
// session: Update/Publish need a remote, Get Data needs a DataLad dataset,
// long-running actions must show a busy state instead of sitting silently.
// Not picked up by `npm test` (node's default test-file pattern requires
// ".test." in the name) — run explicitly via `npm run test:e2e`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { launchApp } from './electron-driver.mjs'
import {
  createTempRoot,
  createPlainGitRepo,
  createGitRepoWithRemote,
  createDatasetFixture,
  createSuperdatasetFixture
} from './fixtures.mjs'

let app
let root

test.before(async () => {
  root = await createTempRoot()
  app = await launchApp()
})

test.after(async () => {
  await app?.close()
})

test('plain git project with no remote: Update, Publish, Get Data all disabled', async () => {
  const projectPath = await createPlainGitRepo(root)
  await app.openProject(projectPath)

  const update = await app.buttonState('update-project')
  const publish = await app.buttonState('publish-project')
  const getData = await app.buttonState('get-data')

  assert.equal(update.disabled, true)
  assert.match(update.title, /No remote is configured/)
  assert.equal(publish.disabled, true)
  assert.match(publish.title, /No remote is configured/)
  assert.equal(getData.disabled, true)
  assert.match(getData.title, /not a DataLad dataset/)
})

test('plain git project with a remote: Update/Publish enabled, Get Data still disabled', async () => {
  const projectPath = await createGitRepoWithRemote(root)
  await app.openProject(projectPath)

  const update = await app.buttonState('update-project')
  const publish = await app.buttonState('publish-project')
  const getData = await app.buttonState('get-data')

  assert.equal(update.disabled, false)
  assert.match(update.title, /origin\/main/)
  assert.equal(publish.disabled, false)
  assert.match(publish.title, /origin\/main/)
  assert.equal(getData.disabled, true)

  const remoteInfo = await app.page.evaluate(() => {
    const el = document.getElementById('remote-info')
    return { hidden: el.hidden, text: el.textContent }
  })
  assert.equal(remoteInfo.hidden, false)
  assert.match(remoteInfo.text, /Remote: origin\/main/)
})

test('DataLad dataset with no remote: Get Data enabled, Update/Publish still disabled', async () => {
  const projectPath = await createDatasetFixture(root)
  await app.openProject(projectPath)

  const getData = await app.buttonState('get-data')
  const update = await app.buttonState('update-project')

  assert.equal(getData.disabled, false)
  assert.equal(update.disabled, true)
})

test('DataLad superdataset: Get Data enabled', async () => {
  const projectPath = await createSuperdatasetFixture(root)
  await app.openProject(projectPath)

  const getData = await app.buttonState('get-data')
  assert.equal(getData.disabled, false)
})

test('Check Setup shows a busy state while running, then recovers', async () => {
  await app.page.evaluate(() => document.getElementById('check-env').click())

  const busy = await app.buttonState('check-env')
  assert.equal(busy.disabled, true)
  assert.equal(busy.text, 'Working…')
  assert.match(busy.classes, /is-busy/)

  // Check Setup probes several tools (python3, datalad, git-annex) via real
  // subprocesses — cold spawn latency on a loaded CI VM can push this past
  // 10s even though it's near-instant locally, see electron-driver.mjs.
  await app.page.waitForFunction(() => !document.getElementById('check-env').disabled, { timeout: 20_000 })
  const done = await app.buttonState('check-env')
  assert.equal(done.text, 'Check Setup')
  assert.doesNotMatch(done.classes, /is-busy/)
})

test('the Active Project Folder field in Save & Sync stays hidden (superseded by the project strip)', async () => {
  const hidden = await app.page.evaluate(() => {
    const input = document.getElementById('command-project-path')
    return input.closest('label').hasAttribute('hidden')
  })
  assert.equal(hidden, true)
})
