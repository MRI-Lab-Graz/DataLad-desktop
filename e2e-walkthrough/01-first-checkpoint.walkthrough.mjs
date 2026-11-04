// Walks docs/tutorials/01-first-checkpoint.md with the real app, real datalad and git-annex.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { launchApp } from '../e2e/electron-driver.mjs'
import { createTempRoot } from '../e2e/fixtures.mjs'
import { requireTools, stepRunner } from './harness.mjs'

requireTools()

const SLOW = 60_000
const MESSAGE = 'pilot: update participant table and project summary'
let app
let root
let project
const step = stepRunner({
  getPage: () => app?.page,
  outDir: join(fileURLToPath(new URL('..', import.meta.url)), 'walkthrough-failures')
})
const git = (...args) => execFileSync('git', args, { cwd: project, encoding: 'utf8' }).trim()
const text = (id) => app.page.evaluate((i) => document.getElementById(i).textContent, id)
const rowFor = (name) => `#changed-files-output li:has([data-diff-path="${name}"])`
// The previous Save's status text can still be showing, so wait on git's commit count, not the page.
async function waitForNewCommit(before) {
  for (let i = 0; i < 120 && Number(git('rev-list', '--count', 'HEAD')) === before; i += 1) await new Promise((r) => setTimeout(r, 500))
}

// git-annex leaves read-only objects; make everything writable first (POSIX only, harmless to skip on Windows).
async function removeTree(dir) {
  if (process.platform !== 'win32') {
    try { execFileSync('chmod', ['-R', 'u+w', dir], { stdio: 'ignore' }) } catch {}
  }
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}

test.before(async () => {
  root = await createTempRoot()
  project = join(root, 'pilot-study-001')
  // "Start from the project created in Tutorial 00", plus the three setup files, saved once.
  execFileSync('datalad', ['create', '-c', 'text2git', project], { stdio: 'ignore' })
  await mkdir(join(project, 'data', 'raw'), { recursive: true })
  await mkdir(join(project, 'analysis'))
  await writeFile(join(project, 'README.md'), 'Purpose: walkthrough pilot.\n')
  await writeFile(join(project, 'data', 'raw', 'participants.tsv'), 'id\tage\nsub-01\t24\nsub-02\t31\n')
  await writeFile(join(project, 'analysis', 'notebook.ipynb'), '{"cells":[],"metadata":{},"nbformat":4,"nbformat_minor":5}\n')
  execFileSync('datalad', ['save', '-d', project, '-m', 'init: create project skeleton and first note'], { stdio: 'ignore' })
  // Setup step 3 and 4: two edits and one scratch file.
  await writeFile(join(project, 'README.md'), 'Purpose: walkthrough pilot.\nAim: test the participant table.\n')
  await writeFile(join(project, 'data', 'raw', 'participants.tsv'), 'id\tage\nsub-01\t25\nsub-02\t31\n')
  await mkdir(join(project, 'notes'))
  await writeFile(join(project, 'notes', 'todo.txt'), 'remember to email the lab\n')
  app = await launchApp({ trustedPaths: [project] }) // identity: true, so no name/email dialog
  await app.openProject(project)
})

test.after(async () => {
  await app?.close()
  if (root) await removeTree(root)
})

test('Tutorial 01 · step 1-2: project opens with a DataLad badge', () =>
  step('Tutorial 01 step 1-2', async () => {
    assert.ok((await text('current-project-path')).endsWith('pilot-study-001'))
    await app.page.waitForFunction(() => document.getElementById('current-project-badge').textContent !== 'Unknown', null, { timeout: SLOW })
    assert.equal(await text('current-project-badge'), 'DataLad')
  }))

test('Tutorial 01 · step 3: changed files are listed', () =>
  step('Tutorial 01 step 3', async () => {
    await app.page.waitForFunction(() => /notes/.test(document.getElementById('changed-files-output').textContent), null, { timeout: SLOW })
    const list = await text('changed-files-output')
    for (const file of ['README.md', 'participants.tsv', 'todo.txt']) assert.match(list, new RegExp(file.replace('.', '\\.')))
  }))

test('Tutorial 01 · step 3: Show changes shows the edit', () =>
  step('Tutorial 01 step 3 diff', async () => {
    await app.page.click(`${rowFor('data/raw/participants.tsv')} .show-diff-button`)
    await app.page.waitForFunction((sel) => /25/.test(document.querySelector(sel)?.textContent ?? ''), `${rowFor('data/raw/participants.tsv')} [data-diff-container]`, { timeout: SLOW })
  }))

test('Tutorial 01 · step 4-5: save only the research files', () =>
  step('Tutorial 01 step 4-5', async () => {
    // Untick the scratch file with a real click on its checkbox.
    const box = '#changed-files-output input[data-changed-path="notes/todo.txt"]'
    if (await app.page.isChecked(box)) await app.page.click(box)
    assert.equal(await app.page.isChecked(box), false)
    assert.equal(await app.page.isChecked('#changed-files-output input[data-changed-path="README.md"]'), true)
  }))

test('Tutorial 01 · step 6-7: Save with the message', () =>
  step('Tutorial 01 step 6-7', async () => {
    const before = Number(git('rev-list', '--count', 'HEAD'))
    await app.page.fill('#message', MESSAGE)
    await app.page.click('#save-project')
    await waitForNewCommit(before)
    assert.equal(Number(git('rev-list', '--count', 'HEAD')), before + 1)
    assert.equal(git('log', '-1', '--format=%s'), MESSAGE)
    assert.match(git('ls-files', '--others', '--exclude-standard'), /notes\/todo\.txt/, 'the scratch file stays untracked')
  }))

test('Tutorial 01 · step 8: status is clean for the saved files', () =>
  step('Tutorial 01 step 8', async () => {
    assert.equal(git('status', '--porcelain'), '?? notes/')
    await app.page.waitForFunction(() => {
      const t = document.getElementById('changed-files-output').textContent
      return /todo\.txt/.test(t) && !/README\.md/.test(t)
    }, null, { timeout: SLOW })
  }))

test('Tutorial 01 · History shows the new save', () =>
  step('Tutorial 01 history', async () => {
    await app.page.click('#open-tools')
    await app.page.click('[data-nav-target="time-machine-zone"]')
    await app.page.waitForFunction((m) => [...document.querySelectorAll('.tm-commit-item')].some((n) => n.textContent.includes(m)), MESSAGE, { timeout: SLOW })
  }))

test('Tutorial 01 · failure injection: ticking the scratch file saves it', () =>
  step('Tutorial 01 failure injection', async () => {
    const box = '#changed-files-output input[data-changed-path="notes/todo.txt"]'
    await app.page.click('#close-tools') // History is a tools view; a student goes back to the project to save again
    await app.page.waitForSelector(box, { timeout: SLOW })
    if (!(await app.page.isChecked(box))) await app.page.click(box)
    const before = Number(git('rev-list', '--count', 'HEAD'))
    await app.page.fill('#message', 'notes: add scratch todo by mistake')
    await app.page.click('#save-project')
    await waitForNewCommit(before)
    assert.match(git('ls-files'), /notes\/todo\.txt/, 'the file is now part of the saved history')
    assert.equal(git('status', '--porcelain'), '')
  }))
