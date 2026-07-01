// Real-Electron smoke tests for filesystem-watch auto-refresh: editing or
// adding files on disk (not through the app) should update the working-tree
// summary and file browser without a manual "Refresh" click.
// Not picked up by `npm test` (node's default test-file pattern requires
// ".test." in the name) — run explicitly via `npm run test:e2e`.
import test from 'node:test'
import { writeFile, appendFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'
import { createTempRoot, createPlainGitRepo } from './fixtures.mjs'

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

let app
let root

test.before(async () => {
  root = await createTempRoot()
  app = await launchApp()
})

test.after(async () => {
  await app?.close()
})

test('a new untracked file on disk appears in the file browser without a manual refresh', async () => {
  const projectPath = await createPlainGitRepo(root)
  await app.openProject(projectPath)

  await appendFile(join(projectPath, 'notes.txt'), 'field notes\n')

  await app.page.waitForFunction(
    () => document.getElementById('files-output').textContent.includes('notes.txt'),
    { timeout: 10_000 }
  )
})

test('editing a tracked file on disk updates the working-tree summary without a manual refresh', async () => {
  const projectPath = await createPlainGitRepo(root)
  // Commit the fixture's untracked README so the working tree starts clean,
  // isolating this test from the "untracked file" case covered above.
  git(['add', 'README.md'], projectPath)
  git(['commit', '-q', '-m', 'track readme'], projectPath)

  await app.openProject(projectPath)
  await app.page.waitForFunction(
    () => !document.getElementById('changed-files-output').textContent.includes('README.md'),
    { timeout: 10_000 }
  )

  await writeFile(join(projectPath, 'README.md'), '# Untracked\nUpdated from outside the app\n')

  await app.page.waitForFunction(
    () => document.getElementById('changed-files-output').textContent.includes('README.md'),
    { timeout: 10_000 }
  )
})
