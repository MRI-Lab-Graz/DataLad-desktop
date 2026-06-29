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

test('Quick Save and Save both map to the same command: a second click while the first is running is rejected, not double-run', async () => {
  const projectPath = await createPlainGitRepo(root)
  await openProjectWithSaveMessage(projectPath, 'e2e: concurrent guard check')

  // The "already running" warning can get overwritten by the winning click's
  // own completion message before we get a chance to read it, so capture
  // every transition instead of sampling the final text once.
  await app.page.evaluate(() => {
    window.__capturedStates = []
    const el = document.getElementById('last-action-state')
    const observer = new MutationObserver(() => window.__capturedStates.push(el.textContent))
    observer.observe(el, { childList: true, characterData: true, subtree: true })
    window.__stateObserver = observer
  })

  // Fire Quick Save (top button) and immediately Save (bottom button) in the
  // same tick, before either has had a chance to resolve.
  await app.page.evaluate(() => {
    document.getElementById('top-quick-save').click()
    document.getElementById('save-project').click()
  })

  await app.page.waitForFunction(
    () => !document.getElementById('top-quick-save').disabled && !document.getElementById('save-project').disabled,
    { timeout: 15_000 }
  )

  const captured = await app.page.evaluate(() => {
    window.__stateObserver.disconnect()
    return window.__capturedStates
  })
  assert.ok(
    captured.some((text) => /Save is already running\./.test(text)),
    `expected an "already running" message among the captured states, got: ${JSON.stringify(captured)}`
  )
})
