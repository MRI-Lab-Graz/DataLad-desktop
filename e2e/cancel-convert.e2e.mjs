// Stopping a multi-step flow from the busy overlay: the overlay covers the
// whole window (so the running strip is unreachable under it) and carries its
// own Stop button. A fake `datalad` makes `create` hang so Stop can be pressed
// mid-step; the flow must end as "Stopped." and never start the next step
// (save). POSIX only: the fake is a shell script.
import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { launchApp } from './electron-driver.mjs'
import { createTempRoot, createPlainGitRepo } from './fixtures.mjs'

const skip = process.platform === 'win32' && 'fake datalad is a shell script'

let app
let logFile

test.before(async () => {
  if (skip) {
    return
  }
  const root = await createTempRoot()
  const binDir = join(root, 'bin')
  logFile = join(root, 'fake-datalad.log')
  await mkdir(binDir)
  await writeFile(logFile, '')
  await writeFile(
    join(binDir, 'datalad'),
    '#!/bin/sh\necho "$*" >> "$FAKE_DATALAD_LOG"\ncase "$*" in\n  *create*) sleep 30 ;;\nesac\nexit 0\n'
  )
  await chmod(join(binDir, 'datalad'), 0o755)

  // launchApp copies process.env into the app's environment.
  process.env.PATH = `${binDir}:${process.env.PATH}`
  process.env.FAKE_DATALAD_LOG = logFile
  app = await launchApp()
  await app.openProject(await createPlainGitRepo(root))
})

test.after(async () => {
  await app?.close()
})

test('Stop on the busy overlay ends a convert flow as Stopped without starting the next step', { skip }, async () => {
  await app.page.evaluate(() => {
    window.confirm = () => true
    const link = document.createElement('a')
    link.setAttribute('data-convert-subdataset-path', 'sub-x')
    link.href = '#'
    document.getElementById('files-output').appendChild(link)
    link.click()
  })

  await app.page.waitForFunction(
    () => !document.getElementById('global-busy-overlay').hidden,
    undefined,
    { timeout: 15_000 }
  )
  await app.page.waitForSelector('#running-commands [data-cancel-run]', { state: 'attached', timeout: 15_000 })

  // The step is stopped while it RUNS: nesting re-checks the project's trust first (a scan), and a Stop pressed during
  // that cancels before the command starts, so wait until the fake datalad has really been asked to create.
  for (let waited = 0; waited < 15_000 && !(await readFile(logFile, 'utf8')).includes('create'); waited += 100) {
    await sleep(100)
  }

  await app.page.evaluate(() => document.getElementById('global-busy-stop').click())

  await app.page.waitForFunction(() => document.getElementById('global-busy-overlay').hidden, undefined, {
    timeout: 15_000
  })
  const pill = await app.page.evaluate(() => document.getElementById('last-action-state').textContent)
  assert.equal(pill, 'Stopped.')

  const invocations = (await readFile(logFile, 'utf8')).split('\n').filter(Boolean)
  assert.ok(invocations.some((line) => line.includes('create')), 'create should have started')
  assert.ok(!invocations.some((line) => /\bsave\b/.test(line)), `save must not start after Stop: ${invocations.join(' | ')}`)
})
