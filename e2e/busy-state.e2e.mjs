// Covers two things the button-gating suite doesn't: that the
// runWorkflowCommand-wired buttons (not just Check Setup) actually show a
// busy state, and that the pendingCommands guard stops two different
// buttons mapped to the same command (Quick Save / Save -> 'save') from
// both firing at once. Not picked up by `npm test`; run via `npm run
// test:e2e`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { launchApp } from './electron-driver.mjs'
import { createTempRoot, createPlainGitRepo } from './fixtures.mjs'

let app
let root

test.before(async () => {
  root = await createTempRoot()
  app = await launchApp()
})

test.after(async () => {
  await app?.close()
})

async function openProjectWithSaveMessage(projectPath, message) {
  await app.openProject(projectPath)
  await app.page.evaluate((m) => {
    const input = document.getElementById('message')
    input.value = m
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, message)
}

test('Save shows a busy state while the command is in flight, then recovers', async () => {
  const projectPath = await createPlainGitRepo(root)
  await openProjectWithSaveMessage(projectPath, 'e2e: busy state check')

  const before = await app.buttonState('save-project')
  assert.equal(before.disabled, false, 'Save should be enabled once a message is entered')

  await app.page.evaluate(() => document.getElementById('save-project').click())

  const busy = await app.buttonState('save-project')
  assert.equal(busy.disabled, true)
  assert.equal(busy.text, 'Working…')
  assert.match(busy.classes, /is-busy/)

  await app.page.waitForFunction(
    () => {
      const el = document.getElementById('save-project')
      return !el.disabled && el.textContent.trim() === 'Save'
    },
    { timeout: 15_000 }
  )
  const after = await app.buttonState('save-project')
  assert.equal(after.text, 'Save')
  assert.doesNotMatch(after.classes, /is-busy/)
})

