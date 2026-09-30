// Real-Electron proof that cancelling works end to end over IPC: a running
// console command is stopped, its process is really gone, and its output is
// streamed as activity events. The UI strip is covered in the last test, once
// the renderer is wired.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'
import { createTempRoot, createPlainGitRepo } from './fixtures.mjs'

let app
let root
let projectPath

test.before(async () => {
  root = await createTempRoot()
  app = await launchApp()
  projectPath = await createPlainGitRepo(root)
  await app.openProject(projectPath)
  await app.page.evaluate(() => window.dataladDesktop.setConsoleEnabled(true))
})

test.after(async () => {
  await app?.close()
})

async function waitFor(check, { timeoutMs = 15_000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) {
      return value
    }
    if (Date.now() > deadline) {
      throw new Error('waitFor timed out')
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

const readIfExists = (file) => readFile(file, 'utf8').catch(() => '')

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// Records its own pid (so the test can prove it is really gone), prints a line
// (for the activity stream), then idles. No `=>` or `>`: on Windows the console
// line goes through cmd.exe.
function slowCommand(pidFile) {
  return (
    `node -e "require('fs').writeFileSync(process.argv[1], String(process.pid)); ` +
    `console.log('working 1'); setInterval(function () {}, 1000)" "${pidFile}"`
  )
}

function runConsole(commandText, runId) {
  return app.page.evaluate(
    (args) => window.dataladDesktop.runConsoleCommand(args),
    { commandText, projectPath, runId }
  )
}

test('cancelCommand stops a running console command and its process', async () => {
  const pidFile = join(root, 'cancel-pid.txt')
  const runId = 'e2e-cancel-1'
  const running = runConsole(slowCommand(pidFile), runId)

  const pid = Number(await waitFor(() => readIfExists(pidFile)))
  assert.equal(await app.page.evaluate((id) => window.dataladDesktop.cancelCommand(id), runId), true)

  const result = await running
  assert.equal(result.cancelled, true)
  assert.equal(result.failed, true)
  await waitFor(() => !isAlive(pid))

  // The run is finished, so a second cancel (a click racing completion) is a harmless false.
  assert.equal(await app.page.evaluate((id) => window.dataladDesktop.cancelCommand(id), runId), false)
})

test('output of a running command is streamed as activity events for its runId', async () => {
  const pidFile = join(root, 'activity-pid.txt')
  const runId = 'e2e-activity-1'
  await app.page.evaluate(() => {
    window.__activity = []
    window.dataladDesktop.onCommandActivity((event) => window.__activity.push(event))
  })
  const running = runConsole(slowCommand(pidFile), runId)

  await app.page.waitForFunction(
    (id) => window.__activity.some((e) => e.runId === id && e.line === 'working 1'),
    runId,
    { timeout: 15_000 }
  )

  await app.page.evaluate((id) => window.dataladDesktop.cancelCommand(id), runId)
  await running
})

test('the running strip shows live output and Cancel stops the command', async () => {
  const pidFile = join(root, 'ui-pid.txt')
  await app.page.evaluate(
    (commandText) => {
      const input = document.getElementById('console-command')
      input.value = commandText
      input.dispatchEvent(new Event('input', { bubbles: true }))
      document.getElementById('console-run').click()
    },
    slowCommand(pidFile)
  )

  const pid = Number(await waitFor(() => readIfExists(pidFile)))

  await app.page.waitForFunction(
    () => document.querySelector('#running-commands .running-line')?.textContent === 'working 1',
    undefined,
    { timeout: 15_000 }
  )
  assert.equal(await app.page.evaluate(() => document.getElementById('running-commands').hidden), false)

  await app.page.evaluate(() => document.querySelector('#running-commands [data-cancel-run]').click())

  await app.page.waitForFunction(() => document.getElementById('running-commands').hidden, undefined, {
    timeout: 15_000
  })
  await waitFor(() => !isAlive(pid))
  const output = await app.page.evaluate(() => document.getElementById('console-output').textContent)
  assert.match(output, /Stopped by you/)
})
