// Walks docs/tutorials/00-create-first-project.md with the real app, real datalad and git-annex.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { launchApp } from '../e2e/electron-driver.mjs'
import { createTempRoot } from '../e2e/fixtures.mjs'
import { requireTools, stepRunner } from './harness.mjs'

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

// git-annex leaves read-only objects; make everything writable first (POSIX only, harmless to skip on Windows).
async function removeTree(dir) {
  if (process.platform !== 'win32') {
    try { execFileSync('chmod', ['-R', 'u+w', dir], { stdio: 'ignore' }) } catch {}
  }
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}

test.before(async () => {
  root = await createTempRoot()
  projectPath = join(root, NAME)
  app = await launchApp({ identity: false })
})

test.after(async () => {
  await app?.close()
  if (root) await removeTree(root)
})

test('Tutorial 00 · step 1: Setup → Check Environment', () =>
  step('Tutorial 00 step 1', async () => {
    await app.page.evaluate(() => document.getElementById('check-env').click())
    await app.page.waitForFunction(() => !document.getElementById('environment-output').hidden && /OK|MISSING/.test(document.getElementById('environment-output').textContent), null, { timeout: SLOW })
    const out = await text('environment-output')
    for (const tool of ['Python', 'DataLad', 'git-annex']) {
      assert.match(out, new RegExp(`${tool}[^:]*: OK`, 'i'), `${tool} should report OK in: ${out}`)
    }
  }))

test('Tutorial 00 · step 0: first launch asks for name and email', () =>
  step('Tutorial 00 step 0', async () => {
    await app.page.waitForSelector('#identity-overlay:not([hidden])', { timeout: 15_000 })
    await app.page.fill('#identity-name', 'Walk Through')
    await app.page.fill('#identity-email', 'walk@example.org')
    await app.page.evaluate(() => document.getElementById('identity-save').click())
    await app.page.waitForSelector('#identity-overlay', { state: 'hidden' })
  }))

test('Tutorial 00 · step 3-4: Create Project', () =>
  step('Tutorial 00 step 3-4', async () => {
    await app.page.evaluate(() => document.getElementById('settings-card')?.setAttribute('hidden', ''))
    await app.page.click('#onboarding-tile-create')
    await app.page.fill('#create-project-path', root)
    await app.page.fill('#create-project-name', NAME)
    await app.page.evaluate(() => document.getElementById('create-project').click())
    await app.page.waitForFunction((p) => document.getElementById('current-project-path').textContent === p, projectPath, { timeout: SLOW })
  }))

test('Tutorial 00 · step 5: project opens', () =>
  step('Tutorial 00 step 5', async () => {
    assert.ok((await text('current-project-path')).endsWith(NAME))
    await app.page.waitForFunction(() => document.getElementById('project-health-output').innerHTML.includes('project-health-grid'), null, { timeout: SLOW })
    await app.page.waitForFunction(() => document.getElementById('current-project-badge').textContent !== 'Unknown', null, { timeout: SLOW })
    assert.match(await text('current-project-badge'), /^DataLad/)
  }))

test('Tutorial 00 · step 6-7: first save', () =>
  step('Tutorial 00 step 6-7', async () => {
    const before = commitCount()
    await writeFile(join(projectPath, 'README.md'), 'Purpose: walkthrough pilot.\nOwner: Walk Through\n')
    await app.page.waitForFunction(() => document.getElementById('changed-files-output').textContent.includes('README.md'), null, { timeout: SLOW })
    await app.page.fill('#message', 'init: create project skeleton and first note')
    await app.page.evaluate(() => document.getElementById('save-project').click())
    await app.page.waitForFunction(() => /Save (completed|failed)/.test(document.getElementById('last-action-state').textContent), null, { timeout: SLOW })
    assert.ok(commitCount() > before, 'a new commit exists')
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: projectPath, encoding: 'utf8' }).trim(), '')
  }))

test('Tutorial 00 · failure injection: non-empty folder is refused', () =>
  step('Tutorial 00 failure injection', async () => {
    await app.page.click('#switch-project') // back to the start screen
    // the tile toggles; the panel may still be open from step 3-4
    if (!(await app.page.isVisible('#create-project-path'))) await app.page.click('#onboarding-tile-create')
    await app.page.fill('#create-project-path', root)
    await app.page.fill('#create-project-name', NAME)
    await app.page.evaluate(() => document.getElementById('create-project').click())
    await app.page.waitForFunction(() => document.getElementById('create-project-output').textContent.includes('is not empty'), null, { timeout: SLOW })
    assert.deepEqual(await readdir(root), [NAME], 'no second project was made')
  }))
