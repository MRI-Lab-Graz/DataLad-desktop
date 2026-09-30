// Drives an *installed* DataLad Desktop (the NSIS installer's output) and asks
// it to check its own environment: proves the installer left Python, DataLad
// and git-annex where the app can find them. Skipped unless DLAD_APP_EXECUTABLE
// points at the installed binary; see .github/workflows/installer-smoke.yml.
import test from 'node:test'
import assert from 'node:assert/strict'
import { launchApp } from './electron-driver.mjs'

const executable = process.env.DLAD_APP_EXECUTABLE

test(
  'installed app reports a ready DataLad environment',
  { skip: !executable && 'set DLAD_APP_EXECUTABLE to the installed binary to run' },
  async () => {
    const app = await launchApp()
    try {
      await app.page.evaluate(() => document.getElementById('check-env').click())
      await app.page.waitForFunction(
        () => /environment is ready|needs attention/.test(document.getElementById('environment-output').textContent),
        undefined,
        { timeout: 60_000 }
      )
      const report = await app.page.evaluate(() => document.getElementById('environment-output').textContent)
      assert.match(report, /DataLad environment is ready/, `Check Environment reported:\n${report}`)
    } finally {
      await app.close()
    }
  }
)
