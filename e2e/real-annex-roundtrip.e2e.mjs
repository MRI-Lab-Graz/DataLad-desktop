// Every other e2e fixture deliberately avoids a real `datalad`/`git-annex`
// install (see fixtures.mjs) so the suite behaves the same on CI runners
// that don't have one. This spec is the one exception: it requires a real
// DataLad install and proves the app's Save button actually round-trips
// through git-annex, not just through the UI. In particular this is what
// verifies the Windows case, where git-annex has no symlink privilege and
// silently switches the dataset to an "adjusted unlocked branch" (annexed
// files become plain regular files instead of symlinks) - `git annex
// whereis` succeeds identically either way, so it's a platform-agnostic
// proof that Save actually handed the file to git-annex.
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
  const root = await mkdtemp(join(tmpdir(), 'dlad-e2e-real-'))
  projectPath = join(root, 'real-dataset')
  execFileSync('datalad', ['create', projectPath], { stdio: 'ignore' })
  app = await launchApp()
})

test.after(async () => {
  await app?.close()
})

test('Save on a real DataLad dataset hands the file to git-annex', async () => {
  await writeFile(join(projectPath, 'roundtrip.txt'), 'e2e real-annex roundtrip\n')
  await app.openProject(projectPath)

  await app.page.evaluate(() => {
    const input = document.getElementById('message')
    input.value = 'e2e: real annex roundtrip'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await app.page.evaluate(() => document.getElementById('save-project').click())

  await app.page.waitForFunction(
    () => {
      const el = document.getElementById('save-project')
      return !el.disabled && el.textContent.trim() === 'Save Checkpoint'
    },
    { timeout: 30_000 }
  )

  // Throws (failing the test) if git-annex never picked up the file, e.g.
  // because Save errored before it reached `datalad save`.
  const whereis = execFileSync('git', ['annex', 'whereis', 'roundtrip.txt'], {
    cwd: projectPath,
    encoding: 'utf8'
  })
  assert.match(whereis, /\(\d+ cop(?:y|ies)\)/)
})
