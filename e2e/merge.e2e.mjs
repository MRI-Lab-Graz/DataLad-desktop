// Drives the real app: two branches change the same file, Merge stops, the researcher picks a version, Finish Merge.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'

let app
let projectPath
const git = (...args) => execFileSync('git', args, { cwd: projectPath, encoding: 'utf8' })
const statusLine = (pattern) =>
  app.page.waitForFunction(
    (source) => new RegExp(source).test(document.getElementById('last-action-state')?.textContent ?? ''),
    pattern.source,
    { timeout: 60_000 }
  )

test.before(async () => {
  projectPath = await mkdtemp(join(tmpdir(), 'dlad-e2e-merge-'))
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'ana@example.org')
  git('config', 'user.name', 'Ana')
  await writeFile(join(projectPath, 'file.txt'), 'base\n')
  git('add', '--', '.')
  git('commit', '-qm', 'base')
  git('checkout', '-qb', 'feature')
  await writeFile(join(projectPath, 'file.txt'), 'feature\n')
  git('commit', '-qam', 'feature edit')
  git('checkout', '-q', 'main')
  await writeFile(join(projectPath, 'file.txt'), 'main\n')
  git('commit', '-qam', 'main edit')
  app = await launchApp({ trustedPaths: [projectPath] })
  await app.openProject(projectPath)
})

test.after(async () => {
  await app?.close()
})

test('a conflicting merge stops, the researcher picks a version, Finish Merge saves it', async () => {
  await app.page.waitForFunction(() => document.querySelector('#merge-branch-select option[value="feature"]'), null, { timeout: 60_000 })
  await app.page.evaluate(() => {
    document.getElementById('merge-branch-select').value = 'feature'
    document.getElementById('merge-branch').click()
  })
  await statusLine(/Merge completed/)
  await app.page.waitForFunction(() => !document.getElementById('merge-banner').hidden, null, { timeout: 60_000 })
  assert.match(await app.page.evaluate(() => document.getElementById('merge-summary').textContent), /1 file to decide/)
  assert.equal(await app.page.evaluate(() => document.getElementById('merge-finish').disabled), true)

  await app.page.evaluate(() => document.querySelector('#merge-conflict-list button[data-side="theirs"]').click())
  await app.page.waitForFunction(() => !document.getElementById('merge-finish').disabled, null, { timeout: 60_000 })
  await app.page.evaluate(() => document.getElementById('merge-finish').click())
  await statusLine(/Finish Merge completed/)

  assert.equal(await readFile(join(projectPath, 'file.txt'), 'utf8'), 'feature\n')
  assert.match(git('log', '-1', '--format=%s'), /^Merge branch 'feature'/)
  await app.page.waitForFunction(() => document.getElementById('merge-banner').hidden, null, { timeout: 60_000 })
})
