// Real-Electron regression test for the Files tab: a huge folder that sorts
// first (code/) used to use up the whole listing budget, so sub-* folders never
// appeared. Folders are now listed one level at a time and read on expand.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'
import { createTempRoot, createDatasetFixture } from './fixtures.mjs'

let app
let projectPath

test.before(async () => {
  const root = await createTempRoot()
  projectPath = await createDatasetFixture(root)
  await mkdir(join(projectPath, 'code'))
  for (let i = 0; i < 600; i += 1) {
    await writeFile(join(projectPath, 'code', `script-${i}.py`), String(i))
  }
  for (const subject of ['sub-001', 'sub-002']) {
    await mkdir(join(projectPath, subject, 'anat'), { recursive: true })
    await writeFile(join(projectPath, subject, 'anat', 'scan.nii'), 'x')
  }
  // Enough folders that the page scrolls, for the scroll-position test below.
  for (let i = 0; i < 60; i += 1) {
    const dir = join(projectPath, `zz-folder-${String(i).padStart(2, '0')}`)
    await mkdir(dir)
    await writeFile(join(dir, 'inner.txt'), 'x')
    // Like real BIDS projects: every subject folder is its own nested repo.
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.'], { cwd: dir })
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'sub'], { cwd: dir })
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

test('expanding a folder keeps the scroll position', async () => {
  const last = 'zz-folder-59'
  await waitForFilesText(new RegExp(last))
  await app.page.locator(`summary:has-text("${last}")`).scrollIntoViewIfNeeded()
  await app.page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const before = await app.page.evaluate(() => window.scrollY)
  assert.ok(before > 500, `page should be scrolled down (was ${before})`)

  await app.page.click(`summary:has-text("${last}")`)
  await app.page.waitForFunction(
    () => /inner\.txt/.test(document.getElementById('files-output').textContent) &&
      document.querySelectorAll('#files-output details[open]').length > 0
  )

  // Sample for a few seconds: a file-watcher refresh can land after the click.
  let after = before
  for (let i = 0; i < 12; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    after = await app.page.evaluate(() => window.scrollY)
    assert.ok(Math.abs(after - before) < 50, `scroll jumped from ${before} to ${after} after ${(i + 1) * 300}ms`)
  }
})

test('expanding a folder updates only that folder, not the whole list', async () => {
  const folder = 'zz-folder-30'
  await app.page.locator(`summary:has-text("${folder}")`).scrollIntoViewIfNeeded()
  // Tag an unrelated row: a full re-render would replace it with a fresh element.
  await app.page.evaluate(() => {
    document.querySelector('#files-output summary').__keepMe = true
  })

  await app.page.click(`summary:has-text("${folder}")`)
  await app.page.waitForFunction(
    (name) => {
      const details = [...document.querySelectorAll('#files-output details')].find((el) => el.textContent.includes(name))
      return details && /inner\.txt/.test(details.textContent)
    },
    folder
  )

  const survived = await app.page.evaluate(() => document.querySelector('#files-output summary').__keepMe === true)
  assert.equal(survived, true, 'unrelated rows were re-created')
})
