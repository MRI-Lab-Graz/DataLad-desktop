// Walks docs/tutorials/03-team-feature-branches.md with the real app, real datalad and git-annex.
// Students edit files outside the app; everything else (create, switch, save, merge, resolve) is a real click.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { launchApp } from '../e2e/electron-driver.mjs'
import { createTempRoot } from '../e2e/fixtures.mjs'
import { removeTree, requireTools, stepRunner } from './harness.mjs'

requireTools()

const SLOW = 60_000
let app
let root
let project
const step = stepRunner({
  getPage: () => app?.page,
  outDir: join(fileURLToPath(new URL('..', import.meta.url)), 'walkthrough-failures')
})
const git = (...args) => execFileSync('git', args, { cwd: project, encoding: 'utf8' }).trim()
const branch = () => git('branch', '--show-current').replace(/^adjusted\//, '').replace(/\([^)]*\)$/, '')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(check, what) {
  for (let i = 0; i < 240; i += 1) {
    if (await check()) return
    await wait(500)
  }
  throw new Error(`timed out waiting for ${what}`)
}
const openBranches = async () => {
  if (await app.page.isVisible('#new-branch-name')) return // already on Tools -> Branches & Ignore
  if (!(await app.page.isVisible('[data-nav-target="project-setup-zone"]'))) await app.page.click('#open-tools')
  await app.page.click('[data-nav-target="project-setup-zone"]')
  await app.page.waitForSelector('#new-branch-name', { state: 'visible', timeout: SLOW })
}
async function createBranch(name) {
  await openBranches()
  await app.page.fill('#new-branch-name', name)
  await app.page.click('#create-branch')
  await until(() => branch() === name, `branch ${name} to be created and checked out`)
}
async function switchTo(name) {
  await openBranches()
  await app.page.waitForFunction((n) => document.querySelector(`#branch-select option[value="${n}"]`), name, { timeout: SLOW })
  await app.page.selectOption('#branch-select', name)
  await app.page.click('#switch-branch')
  await until(() => branch() === name, `switch to ${name}`)
}
// A student edits a file, goes back to the project and clicks Save.
async function editAndSave(file, content, message) {
  await app.page.click('#close-tools')
  const full = join(project, ...file.split('/'))
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, content)
  const before = Number(git('rev-list', '--count', 'HEAD'))
  await app.page.waitForSelector(`#changed-files-output input[data-changed-path="${file}"]`, { timeout: SLOW })
  await app.page.fill('#message', message)
  await app.page.click('#save-project')
  await until(() => Number(git('rev-list', '--count', 'HEAD')) > before, `save "${message}"`)
}
async function mergeFromTools(name) {
  await openBranches()
  await app.page.waitForFunction((n) => document.querySelector(`#merge-branch-select option[value="${n}"]`), name, { timeout: SLOW })
  await app.page.selectOption('#merge-branch-select', name)
  await app.page.click('#merge-branch')
}

test.before(async () => {
  root = await createTempRoot()
  project = join(root, 'team-project')
  const gitConfig = join(root, 'gitconfig')
  await writeFile(gitConfig, '[user]\n\tname = Walk Through\n\temail = walk@example.org\n[init]\n\tdefaultBranch = main\n')
  const env = { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' }
  // Tutorial setup: the three responsibility files and the shared README, saved once on main.
  execFileSync('datalad', ['create', '-c', 'text2git', project], { env })
  await mkdir(join(project, 'scripts'))
  await mkdir(join(project, 'analysis'))
  await mkdir(join(project, 'figures'))
  await writeFile(join(project, 'scripts', 'preprocess.py'), '# preprocess\n')
  await writeFile(join(project, 'analysis', 'stats.R'), '# stats\n')
  await writeFile(join(project, 'figures', 'plot.ipynb'), '{"cells":[],"metadata":{},"nbformat":4,"nbformat_minor":5}\n')
  await writeFile(join(project, 'README.md'), 'Team project.\nLine to argue about: original wording.\n')
  execFileSync('datalad', ['save', '-d', project, '-m', 'init: team project skeleton'], { env })
  app = await launchApp({ trustedPaths: [project] })
  await app.openProject(project)
})

test.after(async () => {
  await app?.close()
  if (root) await removeTree(root)
})

test('Tutorial 03 · setup: create the three feature branches', () =>
  step('Tutorial 03 setup', async () => {
    for (const name of ['feature/preprocessing', 'feature/statistics', 'feature/figures']) {
      await createBranch(name)
      await switchTo('main') // back to main so the next branch starts from main
    }
    const names = git('branch', '--format=%(refname:short)')
    for (const name of ['feature/preprocessing', 'feature/statistics', 'feature/figures']) assert.match(names, new RegExp(name))
  }))

test('Tutorial 03 · steps 1-3: switch to each branch and Save its edits', () =>
  step('Tutorial 03 steps 1-3', async () => {
    await switchTo('feature/preprocessing')
    await editAndSave('scripts/preprocess.py', '# preprocess\nprint("clean")\n', 'preprocessing: clean the data')
    await switchTo('feature/statistics')
    await editAndSave('analysis/stats.R', '# stats\nsummary(x)\n', 'statistics: add summary')
    await switchTo('feature/figures')
    await editAndSave('figures/plot.ipynb', '{"cells":[],"metadata":{"v":2},"nbformat":4,"nbformat_minor":5}\n', 'figures: new plot')
    assert.equal(branch(), 'feature/figures')
  }))

test('Tutorial 03 · steps 4-5: merge the three branches into main, no conflicts', () =>
  step('Tutorial 03 steps 4-5', async () => {
    await switchTo('main')
    for (const name of ['feature/preprocessing', 'feature/statistics', 'feature/figures']) {
      await mergeFromTools(name)
      await until(() => git('branch', '--merged', 'HEAD', '--format=%(refname:short)').split('\n').includes(name), `${name} merged`)
    }
  }))

test('Tutorial 03 · step 6: main is clean and has all three edits', () =>
  step('Tutorial 03 step 6', async () => {
    assert.equal(branch(), 'main')
    assert.equal(git('status', '--porcelain'), '')
    assert.match(await readFile(join(project, 'scripts', 'preprocess.py'), 'utf8'), /clean/)
    assert.match(await readFile(join(project, 'analysis', 'stats.R'), 'utf8'), /summary/)
    assert.match(await readFile(join(project, 'figures', 'plot.ipynb'), 'utf8'), /"v":2/)
  }))

test('Tutorial 03 · failure injection: both branches edit the README line, the merge stops', () =>
  step('Tutorial 03 conflict', async () => {
    await switchTo('feature/statistics')
    await editAndSave('README.md', 'Team project.\nLine to argue about: statistics wording.\n', 'statistics: README wording')
    await switchTo('feature/figures')
    await editAndSave('README.md', 'Team project.\nLine to argue about: figures wording.\n', 'figures: README wording')
    await switchTo('feature/statistics')
    await mergeFromTools('feature/figures')
    // The message says "decide each file in the Merge banner": the student must be able to see it without hunting.
    await app.page.waitForSelector('#merge-banner', { state: 'visible', timeout: SLOW })
    assert.match(await app.page.evaluate(() => document.getElementById('merge-summary').textContent), /1 file to decide/)
    assert.equal(await app.page.evaluate(() => document.getElementById('merge-finish').disabled), true, 'Finish Merge waits for a decision')
  }))

test('Tutorial 03 · recovery: choose the other branch\'s wording, Finish Merge', () =>
  step('Tutorial 03 recovery', async () => {
    await app.page.click('#merge-conflict-list button[data-side="theirs"]')
    await app.page.waitForFunction(() => !document.getElementById('merge-finish').disabled, null, { timeout: SLOW })
    await app.page.click('#merge-finish')
    await until(() => /^Merge branch/.test(git('log', '-1', '--format=%s')), 'merge commit')
    assert.match(await readFile(join(project, 'README.md'), 'utf8'), /figures wording/)
    assert.equal(git('status', '--porcelain'), '')
  }))
