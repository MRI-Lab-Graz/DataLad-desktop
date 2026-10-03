// Real-Electron proof of two console controls in the main process:
// an admin policy that removes the console even if the renderer enables it,
// and confinement of the console's working directory to authorized roots.
import test from 'node:test'
import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'
import { createTempRoot, createPlainGitRepo } from './fixtures.mjs'

const call = (app, cwd, commandText) =>
  app.page.evaluate(
    async ({ cwd, commandText }) => {
      try {
        await window.dataladDesktop.setConsoleEnabled(true)
        await window.dataladDesktop.runConsoleCommand({ commandText, projectPath: cwd })
        return { rejected: false }
      } catch (error) {
        return { rejected: true, message: String(error?.message ?? error) }
      }
    },
    { cwd, commandText }
  )

test('admin policy keeps the console off even when the renderer enables it', async () => {
  const root = await createTempRoot()
  const projectPath = await createPlainGitRepo(root)
  const app = await launchApp({ env: { DATALAD_DESKTOP_DISABLE_CONSOLE: '1' } })
  try {
    await app.openProject(projectPath)
    const marker = join(projectPath, 'policy-marker')
    const result = await call(app, projectPath, `git config --file ${marker} a.b c`)
    assert.equal(result.rejected, true)
    assert.match(result.message, /administrator/i)
    await assert.rejects(access(marker))
  } finally {
    await app.close()
  }
})

test('console refuses a working directory outside the authorized roots', async () => {
  const root = await createTempRoot()
  const projectPath = await createPlainGitRepo(root)
  const outside = await createTempRoot()
  const app = await launchApp()
  try {
    await app.openProject(projectPath)
    const result = await call(app, outside, 'git --version')
    assert.equal(result.rejected, true)
    assert.match(result.message, /not part of an opened project/i)
  } finally {
    await app.close()
  }
})
