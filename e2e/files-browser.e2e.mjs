// Real-Electron regression test for the Files tab: a huge folder that sorts
// first (code/) used to use up the whole listing budget, so sub-* folders never
// appeared. Folders are now listed one level at a time and read on expand.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'
import { createTempRoot, createPlainGitRepo } from './fixtures.mjs'

let app
let projectPath

test.before(async () => {
  const root = await createTempRoot()
  projectPath = await createPlainGitRepo(root)
  await mkdir(join(projectPath, 'code'))
  for (let i = 0; i < 600; i += 1) {
    await writeFile(join(projectPath, 'code', `script-${i}.py`), String(i))
  }
  for (const subject of ['sub-001', 'sub-002']) {
    await mkdir(join(projectPath, subject, 'anat'), { recursive: true })
    await writeFile(join(projectPath, subject, 'anat', 'scan.nii'), 'x')
  }
  app = await launchApp()
  await app.openProject(projectPath)
  await app.page.click('[data-nav-target="files-panel"]')
})

test.after(async () => {
  await app?.close()
})

const filesText = () => app.page.evaluate(() => document.getElementById('files-output').textContent)

async function waitForFilesText(pattern) {
  await app.page.waitForFunction(
    (source) => new RegExp(source).test(document.getElementById('files-output').textContent),
    pattern.source,
    { timeout: 15_000 }
  )
}

test('top-level sub-* folders are listed even when code/ holds hundreds of files', async () => {
  await waitForFilesText(/sub-002/)
  const text = await filesText()
  assert.match(text, /sub-001/)
  assert.match(text, /sub-002/)
  assert.doesNotMatch(text, /Listing truncated/)
})

test('expanding a folder loads its children on demand', async () => {
  assert.doesNotMatch(await filesText(), /scan\.nii/)

  await app.page.click('summary:has-text("sub-001")')
  await waitForFilesText(/anat/)

  await app.page.click('summary:has-text("anat")')
  await waitForFilesText(/scan\.nii/)
})
