// Real-Electron proof that the command console is gated in the main process,
// not just in the UI: with power-user mode off (the default) a renderer that
// calls console:runCommand directly must be refused and nothing may run.
import test from 'node:test'
import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'
import { createTempRoot, createPlainGitRepo } from './fixtures.mjs'

let app
let projectPath

test.before(async () => {
  const root = await createTempRoot()
  projectPath = await createPlainGitRepo(root)
  app = await launchApp()
  await app.openProject(projectPath)
})

test.after(async () => {
  await app?.close()
})

function runConsole(commandText) {
  return app.page.evaluate(
    async ({ commandText: text, projectPath: cwd }) => {
      try {
        await window.dataladDesktop.runConsoleCommand({ commandText: text, projectPath: cwd })
        return { rejected: false }
      } catch (error) {
        return { rejected: true, message: String(error?.message ?? error) }
      }
    },
    { commandText, projectPath }
  )
}

test('console:runCommand refuses to run while power-user mode is off', async () => {
  const marker = join(projectPath, 'console-gate-marker')
  const result = await runConsole(`git config --file ${marker} a.b c`)

  assert.equal(result.rejected, true)
  assert.match(result.message, /console is disabled/i)
  await assert.rejects(access(marker))
})
