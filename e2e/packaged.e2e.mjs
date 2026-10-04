// Smoke test for the *built* app (electron-builder output), not the source
// checkout: catches packaging-only breakage such as files missing from the
// asar or a main-process path that only resolves outside app.asar. Skipped
// unless DLAD_APP_EXECUTABLE points at the packaged binary, so the regular
// `npm run test:e2e` run is unaffected. CI sets it after `npm run package:dir`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { launchApp } from './electron-driver.mjs'
import { createTempRoot, createPlainGitRepo } from './fixtures.mjs'

const executable = process.env.DLAD_APP_EXECUTABLE

test(
  'packaged app boots from its asar and opens a real git project',
  { skip: !executable && 'set DLAD_APP_EXECUTABLE to the packaged binary to run' },
  async () => {
    // The folder is trusted up front: a packaged app asks before opening any folder it did not create.
    const projectPath = await createPlainGitRepo(await createTempRoot())
    const app = await launchApp({ trustedPaths: [projectPath] })
    try {
      const href = await app.page.evaluate(() => location.href)
      assert.match(href, /app\.asar/, `renderer was not loaded from app.asar: ${href}`)

      // Opening a project makes the packaged main process spawn git and answer
      // over IPC; openProject only returns once the health card has rendered.
      await app.openProject(projectPath)
    } finally {
      await app.close()
    }
  }
)
