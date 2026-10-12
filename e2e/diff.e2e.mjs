// Real Electron: the diff view on Home and in History, a name with a space, and proof that a repository's
// own diff driver / textconv is never run. Plain git only (no DataLad needed). Run via `npm run test:e2e`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'
import { createTempRoot } from './fixtures.mjs'

let app
let root
let project
let firstSave

const git = (...args) => execFileSync('git', args, { cwd: project, encoding: 'utf8' }).trim()

test.before(async () => {
  root = await createTempRoot()
  project = join(root, 'study')
  await mkdir(project)
  git('init', '-q')
  git('config', 'user.email', 'e2e@example.org')
  git('config', 'user.name', 'E2E Test')
  await writeFile(join(project, 'participants.tsv'), 'id\tage\nsub-01\t24\nsub-02\t31\n')
  await writeFile(join(project, 'my file.csv'), 'a,b\n1,2\n')
  git('add', '.')
  git('commit', '-q', '-m', 'first table')
  firstSave = git('rev-parse', '--short', 'HEAD')
  await writeFile(join(project, 'participants.tsv'), 'id\tage\nsub-01\t25\nsub-02\t31\n')
  await writeFile(join(project, 'my file.csv'), 'a,b\n1,3\n')
  app = await launchApp({ trustedPaths: [project] })
  await app.openProject(project)
})

test.after(async () => {
  await app?.close()
})

const rowFor = (name) => `#changed-files-output li:has([data-diff-path="${name}"])`

test('Show changes on Home highlights the changed cell of a TSV', async () => {
  await app.page.waitForSelector(rowFor('participants.tsv'), { timeout: 30_000 })
  await app.page.click(`${rowFor('participants.tsv')} .show-diff-button`)
  await app.page.waitForSelector(`${rowFor('participants.tsv')} .diff-cell-changed`, { timeout: 30_000 })
  const cells = await app.page.evaluate((selector) => [...document.querySelectorAll(`${selector} .diff-cell-changed`)].map((node) => node.textContent), rowFor('participants.tsv'))
  assert.deepEqual(cells, ['24', '25'])
})

test('a file with a space in its name opens its diff too', async () => {
  await app.page.click(`${rowFor('my file.csv')} .show-diff-button`)
  await app.page.waitForSelector(`${rowFor('my file.csv')} .diff-add`, { timeout: 30_000 })
})

test('Compare with now in History lists the changed files and opens a diff', async () => {
  await app.page.evaluate(() => {
    if (document.getElementById('project-tools').hidden) document.getElementById('open-tools').click()
    document.querySelector('[data-nav-target="time-machine-zone"]').click()
  })
  await app.page.waitForSelector('.tm-commit-item', { timeout: 30_000 })
  await app.page.click(`.tm-commit-item[data-hash^="${firstSave}"]`)
  await app.page.waitForSelector('#tm-compare', { state: 'visible' })
  await app.page.click('#tm-compare')
  await app.page.waitForSelector('#tm-compare-output .show-diff-button', { timeout: 30_000 })
  const listed = await app.page.evaluate(() => document.getElementById('tm-compare-output').textContent)
  assert.match(listed, /participants\.tsv/)
  assert.match(listed, /my file\.csv/)
  await app.page.click('#tm-compare-output li:has([data-diff-path="participants.tsv"]) .show-diff-button')
  await app.page.waitForSelector('#tm-compare-output .diff-cell-changed', { timeout: 30_000 })
})

test('a repository that names a diff driver and textconv never gets to run it', { skip: process.platform === 'win32' }, async () => {
  const evilRoot = await createTempRoot()
  const evil = join(evilRoot, 'evil')
  const sentinel = join(evilRoot, 'PWNED')
  const script = join(evilRoot, 'evil.sh')
  await mkdir(evil)
  await writeFile(script, `#!/bin/sh\ntouch "${sentinel}"\ncat "$1"\n`)
  await chmod(script, 0o755)
  const run = (...args) => execFileSync('git', args, { cwd: evil })
  run('init', '-q')
  run('config', 'user.email', 'e2e@example.org')
  run('config', 'user.name', 'E2E Test')
  await writeFile(join(evil, '.gitattributes'), '*.tsv diff=evil\n')
  await writeFile(join(evil, 'a.tsv'), 'id\tage\n1\t1\n')
  run('add', '.')
  run('commit', '-q', '-m', 'first')
  run('config', 'diff.evil.textconv', script)
  run('config', 'diff.external', script)
  await writeFile(join(evil, 'a.tsv'), 'id\tage\n1\t2\n')

  await app.openProject(evil)
  await app.page.waitForSelector(rowFor('a.tsv'), { timeout: 30_000 })
  await app.page.click(`${rowFor('a.tsv')} .show-diff-button`)
  await app.page.waitForSelector(`${rowFor('a.tsv')} .diff-cell-changed`, { timeout: 30_000 })
  await assert.rejects(() => access(sentinel), 'the repository\'s textconv / external diff must not have run')
})
