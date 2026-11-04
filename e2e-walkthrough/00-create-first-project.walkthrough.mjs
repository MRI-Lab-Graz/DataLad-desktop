// Walks docs/tutorials/00-create-first-project.md with the real app, real datalad and git-annex.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { launchApp } from '../e2e/electron-driver.mjs'
import { createTempRoot } from '../e2e/fixtures.mjs'
import { removeTree, requireTools, stepRunner } from './harness.mjs'

requireTools()

const NAME = 'pilot-study-001'
const SLOW = 60_000
let app
let root
let projectPath
const step = stepRunner({
  getPage: () => app?.page,
  outDir: join(fileURLToPath(new URL('..', import.meta.url)), 'walkthrough-failures')
})
const text = (id) => app.page.evaluate((i) => document.getElementById(i).textContent, id)
const commitCount = () => Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: projectPath, encoding: 'utf8' }))

// A packaged app always asks a native confirmation before creating a project in a new folder.
const NEEDS_SOURCE_APP = process.env.DLAD_APP_EXECUTABLE
  ? { skip: 'packaged app asks a native confirmation a script cannot click' }
  : {}

test.before(async () => {
  root = await createTempRoot()
  projectPath = join(root, NAME)
  app = await launchApp({ identity: false })
})

test.after(async () => {
  await app?.close()
  if (root) await removeTree(root)
})

test('Tutorial 00 · step 0: first launch asks for name and email', () =>
  step('Tutorial 00 step 0', async () => {
    await app.page.waitForSelector('#identity-overlay:not([hidden])', { timeout: 15_000 })
    await app.page.fill('#identity-name', 'Walk Through')
    await app.page.fill('#identity-email', 'walk@example.org')
    await app.page.click('#identity-save')
    await app.page.waitForSelector('#identity-overlay', { state: 'hidden' })
    // The name reached the driver's temp git config (and so never the developer's own ~/.gitconfig).
    assert.equal(execFileSync('git', ['config', '--file', app.gitConfigGlobal, 'user.name'], { encoding: 'utf8' }).trim(), 'Walk Through')
  }))

// The identity dialog covers the window at first launch, so a student answers it before reaching Setup.
test('Tutorial 00 · step 1: Setup → Check Environment', () =>
  step('Tutorial 00 step 1', async () => {
    await app.page.click('#close-settings') // the driver opened Setup already; close it, then open it like a student
    assert.ok(!(await app.page.isVisible('#check-env')), 'Setup is closed before the click')
    await app.page.click('#open-settings')
    assert.ok(await app.page.isVisible('#check-env'), 'Setup shows Check Environment')
    await app.page.click('#check-env')
    await app.page.waitForFunction(() => !document.getElementById('environment-output').hidden && /OK|MISSING/.test(document.getElementById('environment-output').textContent), null, { timeout: SLOW })
    const out = await text('environment-output')
    for (const tool of ['Python', 'DataLad', 'git-annex']) {
      assert.match(out, new RegExp(`${tool}[^:]*: OK`, 'i'), `${tool} should report OK in: ${out}`)
    }
  }))

test('Tutorial 00 · step 3-4: Create Project', NEEDS_SOURCE_APP, () =>
  step('Tutorial 00 step 3-4', async () => {
    await app.page.click('#close-settings') // the Setup card sits above the start tiles; a student closes it first
    await app.page.click('#onboarding-tile-create')
    await app.page.fill('#create-project-path', root)
    await app.page.fill('#create-project-name', NAME)
    await app.page.click('#create-project')
    await app.page.waitForFunction((p) => document.getElementById('current-project-path').textContent === p, projectPath, { timeout: SLOW })
  }))

test('Tutorial 00 · step 5: project opens', NEEDS_SOURCE_APP, () =>
  step('Tutorial 00 step 5', async () => {
    assert.ok((await text('current-project-path')).endsWith(NAME))
    await app.page.waitForFunction(() => document.getElementById('project-health-output').innerHTML.includes('project-health-grid'), null, { timeout: SLOW })
    await app.page.waitForFunction(() => document.getElementById('current-project-badge').textContent !== 'Unknown', null, { timeout: SLOW })
    assert.match(await text('current-project-badge'), /^DataLad/)
  }))

test('Tutorial 00 · step 6-7: first save', NEEDS_SOURCE_APP, () =>
  step('Tutorial 00 step 6-7', async () => {
    const before = commitCount()
    await writeFile(join(projectPath, 'README.md'), 'Purpose: walkthrough pilot.\nOwner: Walk Through\n')
    await app.page.waitForFunction(() => document.getElementById('changed-files-output').textContent.includes('README.md'), null, { timeout: SLOW })
    await app.page.fill('#message', 'init: create project skeleton and first note')
    await app.page.click('#save-project')
    await app.page.waitForFunction(() => /Save (completed|failed)/.test(document.getElementById('last-action-state').textContent), null, { timeout: SLOW })
    assert.ok(commitCount() > before, 'a new commit exists')
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: projectPath, encoding: 'utf8' }).trim(), '')
  }))

test('Tutorial 00 · failure injection: non-empty folder is refused', NEEDS_SOURCE_APP, () =>
  step('Tutorial 00 failure injection', async () => {
    const commitsBefore = commitCount()
    const shownBefore = await text('current-project-path')
    await app.page.click('#switch-project') // back to the start screen
    // the tile toggles; the panel may still be open from step 3-4
    if (!(await app.page.isVisible('#create-project-path'))) await app.page.click('#onboarding-tile-create')
    await app.page.fill('#create-project-path', root)
    await app.page.fill('#create-project-name', NAME)
    await app.page.click('#create-project')
    await app.page.waitForFunction(() => document.getElementById('create-project-output').textContent.includes('is not empty'), null, { timeout: SLOW })
    assert.deepEqual(await readdir(root), [NAME], 'no second project was made')
    assert.equal(commitCount(), commitsBefore, 'the existing project got no new commit')
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: projectPath, encoding: 'utf8' }).trim(), '')
    assert.ok((await readdir(projectPath)).includes('README.md'), 'README.md is still there')
    assert.equal(await text('current-project-path'), shownBefore, 'the open project did not change')
  }))
