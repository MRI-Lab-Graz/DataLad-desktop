// Launches the real DataLad Desktop app and connects to it over Chrome
// DevTools Protocol so tests can drive the actual renderer DOM — not a
// mock of it. Requires `playwright-core` (devDependency) but not a full
// Playwright install. See test/e2e in package.json scripts for usage.
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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

  // Without this, the app launches against the real per-machine profile
  // (localStorage, settings.json), so anything a developer toggled while
  // manually poking at the app (e.g. Power User Mode) silently leaks into
  // every later e2e run on that machine and changes button labels/gating
  // out from under the tests — see the 'Commit' vs 'Save Checkpoint'
  // mismatch this caused. A fresh --user-data-dir per launch makes every
  // run hermetic regardless of what's been clicked around locally before.
  const userDataDir = await mkdtemp(join(tmpdir(), 'dlad-e2e-userdata-'))

  // The first `datalad status` probe detectProject runs (see
  // DataLadAdapter#probeDataLadDataset) pays a one-time cold-start cost —
  // spawning the Python interpreter and importing the datalad package — that
  // can exceed openProject's 30s budget on a loaded CI runner if it lands on
  // the first dataset-fixture test instead of here. Pay it now, in parallel
  // with the Electron launch, so every later probe in this test file is warm.
  const warmUp = warmUpDatalad()

  const child = spawn(
    electronPath,
    [APP_DIR, '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`],
    {
      cwd: APP_DIR,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  try {
    const app = await connect(child)
    await warmUp
    return app
  } catch (err) {
    // A failure below (e.g. #check-env never appears) leaves the spawned
    // Electron process and any open CDP socket dangling. Nothing then
    // references them, so node --test never exits its event loop until CI's
    // job timeout kills it hours later. Callers whose test.before() throws
    // never get an `app` to call close() on, so the cleanup has to happen
    // here, not by the caller.
    child.kill()
    throw err
  }
}

function warmUpDatalad() {
  return new Promise((resolve) => {
    const probe = spawn('datalad', ['--version'], { stdio: 'ignore' })
    probe.on('error', () => resolve())
    probe.on('exit', () => resolve())
  })
}

async function connect(child) {
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
      // Startup detection is done, but the pipes must keep draining for the
      // rest of the process's life: with stdio: 'pipe' and no reader, the OS
      // pipe buffer fills up as soon as the app (or a spawned datalad/git
      // subprocess whose output it forwards) writes enough to stdout/stderr,
      // and the child then blocks on write() — silently hanging whatever
      // app command triggered the output. Windows' smaller default pipe
      // buffers made this show up reliably on `Save`, which is the most
      // output-heavy command; resume() with no 'data' listener discards
      // instead of buffering.
      child.stdout.resume()
      child.stderr.resume()
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

  try {
    return await attachToWindow(browser, child)
  } catch (err) {
    await browser.close().catch(() => {})
    throw err
  }
}

async function attachToWindow(browser, child) {
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
  // #check-env lives inside the Setup panel, which starts `hidden` until
  // #open-settings is clicked.
  await page.waitForSelector('#open-settings', { timeout: 10_000 })
  await page.evaluate(() => document.getElementById('open-settings').click())
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
    // detectProject spawns real git/datalad subprocesses through the main
    // process. Per-spawn cost on a loaded CI VM (antivirus scanning each new
    // process on Windows runners, general VM noise, etc.) varies enough that
    // any individual spawn — not just the first one warmUpDatalad() above
    // covers — can occasionally take far longer than on a warm local
    // machine: a 10s budget was observed timing out on the very first probe,
    // and even after warming DataLad up front, a later probe elsewhere in
    // the run has still hit a 30s budget. This is CI spawn latency, not an
    // app hang.
    await page.waitForFunction(
      (p) => document.getElementById('current-project-path').textContent === p,
      projectPath,
      { timeout: 60_000 }
    )
    await page.waitForFunction(
      () => document.getElementById('project-health-output').innerHTML.includes('project-health-grid'),
      undefined,
      { timeout: 60_000 }
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
