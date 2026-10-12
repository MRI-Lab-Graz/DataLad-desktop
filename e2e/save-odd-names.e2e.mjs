// Regression: git quotes names with a space (?? "my file.csv"); the quotes once ended up in the path
// given to datalad save, which matched nothing, and the app still said "Save completed.".
// Real DataLad + git-annex needed (like science-workflow.e2e.mjs). Run via `npm run test:e2e`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'

let app
let projectPath

test.before(async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-e2e-names-'))
  projectPath = join(root, 'study')
  execFileSync('datalad', ['create', projectPath])
  await writeFile(join(projectPath, 'my file.csv'), 'a,b\n1,2\n')
  // git-annex on Windows cannot open files with non-ASCII names ("add(error): Größe ä.txt (file) [git-annex:
  // Größe ä.txt not found]", seen on the windows-latest runner): the app passes the right name, git-annex fails.
  if (process.platform !== 'win32') {
    await writeFile(join(projectPath, 'Größe ä.txt'), 'x')
  }
  app = await launchApp({ trustedPaths: [projectPath] })
  await app.openProject(projectPath)
})

test.after(async () => {
  await app?.close()
})

test('files with spaces and umlauts are listed by their real names and really saved', async () => {
  await app.page.waitForFunction(
    () => document.getElementById('changed-files-output').textContent.includes('my file.csv'),
    null,
    { timeout: 30_000 }
  )
  const listed = await app.page.evaluate(() => document.getElementById('changed-files-output').textContent)
  assert.doesNotMatch(listed, /"my file\.csv"/, 'the quotes are not part of the name')

  await app.page.fill('#message', 'add files with odd names')
  await app.page.click('#save-project')
  await app.page.waitForFunction(
    () => /Save (completed|failed)/.test(document.getElementById('last-action-state').textContent),
    null,
    { timeout: 60_000 }
  )

  // Not `log -1`: on Windows DataLad puts the project in git-annex's adjusted-branch mode, where HEAD's newest
  // commit is git-annex's own synthetic "git-annex adjusted branch" commit, not the save. Find the save by message.
  const saved = execFileSync(
    'git',
    ['-C', projectPath, '-c', 'core.quotePath=false', 'log', '--all', '--grep=add files with odd names', '--name-only', '--format=%s'],
    { encoding: 'utf8' }
  )
  // What the app showed and what git still sees, so a failure on another platform explains itself.
  const status = execFileSync('git', ['-C', projectPath, '-c', 'core.quotePath=false', 'status', '--porcelain'], { encoding: 'utf8' })
  const output = await app.page.evaluate(() => document.getElementById('command-output')?.textContent)
  const why = `\n--- listed in the app:\n${listed}\n--- command output:\n${output}\n--- git status after:\n${status}\n--- git log:\n${saved}`
  assert.match(saved, /add files with odd names/, why)
  assert.match(saved, /my file\.csv/, why)
  if (process.platform !== 'win32') {
    assert.match(listed, /Größe ä\.txt/, `the umlaut file is listed by its real name${why}`)
    assert.match(saved, /Größe ä\.txt/, `the umlaut file was saved${why}`)
  }
})
