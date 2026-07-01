// Launches the real DataLad Desktop app and connects to it over Chrome
// DevTools Protocol so tests can drive the actual renderer DOM — not a
// mock of it. Requires `playwright-core` (devDependency) but not a full
// Playwright install. See test/e2e in package.json scripts for usage.
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import electronPath from 'electron'

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

export async function launchApp() {
  // Setting this to '' (rather than deleting it) does NOT reliably clear it
  // on Windows: empty-string env vars get dropped when child_process builds
  // the Windows environment block, so the parent's truthy value (if any)
  // leaks through and Electron launches in "run as Node" mode instead of
  // as a real app — surfacing as "module 'electron' does not provide an
  // export named 'BrowserWindow'". Deleting the key avoids the platform
  // quirk entirely.
  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE

  const child = spawn(electronPath, [APP_DIR, '--remote-debugging-port=0'], {
    cwd: APP_DIR,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const port = await new Promise((resolve, reject) => {
    let buffer = ''
    const onData = (chunk) => {
      buffer += chunk.toString()
      const match = buffer.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)
      if (match) {
        cleanup()
        resolve(Number(match[1]))
      }
    }
    const onExit = (code) => {
      cleanup()
      reject(new Error(`Electron exited before DevTools came up (code ${code}). Output:\n${buffer}`))
    }
    const cleanup = () => {
      child.stdout.off('data', onData)
      child.stderr.off('data', onData)
      child.off('exit', onExit)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', onExit)
    setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for Electron DevTools port. Output so far:\n${buffer}`))
    }, 20_000)
  })

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)

  let page = null
  for (let attempt = 0; attempt < 20 && !page; attempt += 1) {
    for (const ctx of browser.contexts()) {
      for (const candidate of ctx.pages()) {
        if (!candidate.url().startsWith('devtools://')) {
          page = candidate
        }
      }
    }
    if (!page) {
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  if (!page) {
    throw new Error('Could not find the app window over CDP')
  }
  await page.waitForSelector('#check-env', { timeout: 10_000 })

  async function openProject(projectPath) {
    // setCurrentProjectHeader fires off refreshProjectHealth without
    // awaiting it, so the path/badge can update before the health-driven
    // button gating has actually been (re)computed. The health card is the
    // only visible signal that the async fetch (and therefore
    // applyRemoteGatedButtons) has completed for *this* project rather than
    // a previous one — so clear it to a sentinel first, then wait for it to
    // be replaced, instead of guessing a fixed delay or risking a match
    // against stale content left over from the last project opened.
    await page.evaluate(() => {
      document.getElementById('project-health-output').innerHTML = 'e2e-pending'
    })

    await page.evaluate((p) => {
      const input = document.getElementById('project-path')
      input.value = p
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, projectPath)
    await page.evaluate(() => document.getElementById('detect-project').click())
    await page.waitForFunction(
      (p) => document.getElementById('current-project-path').textContent === p,
      projectPath,
      { timeout: 10_000 }
    )
    await page.waitForFunction(
      () => document.getElementById('project-health-output').innerHTML.includes('project-health-grid'),
      { timeout: 10_000 }
    )
  }

  async function buttonState(id) {
    return page.evaluate((elementId) => {
      const el = document.getElementById(elementId)
      return { disabled: el.disabled, title: el.title, text: el.textContent.trim(), classes: el.className }
    }, id)
  }

  async function close() {
    await browser.close().catch(() => {})
    child.kill()
  }

  return { page, openProject, buttonState, close }
}
