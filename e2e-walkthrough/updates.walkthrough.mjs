// The update notice with the real app, against a local fake PyPI and Homebrew feed (never the internet).
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { launchApp } from '../e2e/electron-driver.mjs'
import { removeTree, requireTools, stepRunner } from './harness.mjs'

requireTools()

const BODIES = {
  '/pypi/datalad/json': { info: { version: '99.0.0' } },
  '/api/formula/git-annex.json': { versions: { stable: '99.0.0' } },
  '/api/formula/datalad.json': { versions: { stable: '99.0.0' } }, // a DataLad from Homebrew is compared with Homebrew
  '/pypi/prism-validator/json': { info: { version: '0.0.1' }, releases: {} }
}
let requests = 0
let server
let feed
let app
const profiles = []
const step = stepRunner({
  getPage: () => app?.page,
  outDir: join(fileURLToPath(new URL('..', import.meta.url)), 'walkthrough-failures')
})
const rows = () => app.page.$$eval('#update-notice .update-row', (els) => els.map((el) => el.textContent))
const visible = () => app.page.evaluate(() => !document.getElementById('update-notice').hidden)
const waitForDatalad = () =>
  app.page.waitForFunction(
    () => !document.getElementById('update-notice').hidden &&
      [...document.querySelectorAll('#update-notice .update-row')].some((r) => /DataLad/i.test(r.textContent) && r.textContent.includes('99.0.0')),
    undefined,
    { timeout: 40_000 }
  )

test.before(async () => {
  server = http.createServer((req, res) => {
    requests += 1
    const body = BODIES[req.url]
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body ?? {}))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  feed = `http://127.0.0.1:${server.address().port}`
})

// A failed test must not leave its Electron process behind (it would hang the runner).
test.afterEach(async () => {
  await app?.close()
  app = null
})

test.after(async () => {
  await app?.close()
  server?.closeAllConnections()
  await new Promise((resolve) => server?.close(resolve))
  for (const dir of profiles) await removeTree(dir)
})

async function launch(options) {
  app = await launchApp(options)
  profiles.push(app.userDataDir)
  return app
}

test('a newer DataLad shows a notice; Skip this version hides it, also after a restart', () =>
  step('Update notice skip', async () => {
    const env = { DLAD_UPDATE_FEED: feed, DATALAD_DESKTOP_DISABLE_UPDATE_CHECK: '0' }
    await launch({ env })
    const { userDataDir } = app
    await waitForDatalad()

    // Keyboard: Tab reaches the Skip button, Enter presses it.
    const skip = app.page.locator('#update-notice .update-row', { hasText: 'DataLad' }).first().getByRole('button', { name: 'Skip this version' })
    await app.page.evaluate(() => document.activeElement?.blur())
    let reached = false
    for (let i = 0; i < 60 && !reached; i += 1) {
      await app.page.keyboard.press('Tab')
      reached = await app.page.evaluate(() => document.activeElement?.closest('#update-notice') !== null && document.activeElement?.tagName === 'BUTTON')
    }
    assert.ok(reached, 'Tab reaches a Skip button inside the notice')
    await skip.focus()
    await app.page.keyboard.press('Enter')
    await app.page.waitForFunction(
      () => ![...document.querySelectorAll('#update-notice .update-row')].some((r) => /DataLad/i.test(r.textContent) && r.textContent.includes('99.0.0')),
      undefined,
      { timeout: 10_000 }
    )

    await app.close()
    app = null
    await launch({ env, userDataDir })
    // Not vacuous: if the DataLad row came back, the strip would turn visible, the wait would end and the assertion below would fail.
    await app.page.waitForFunction(() => !document.getElementById('update-notice').hidden, undefined, { timeout: 40_000 }).catch(() => {})
    assert.ok(!(await rows()).some((t) => /DataLad/i.test(t) && t.includes('99.0.0')), 'the skipped DataLad notice stays gone')
  }))

test('a real click on Skip this version removes that row', () =>
  step('Update notice click', async () => {
    await launch({ env: { DLAD_UPDATE_FEED: feed, DATALAD_DESKTOP_DISABLE_UPDATE_CHECK: '0' } })
    await waitForDatalad()
    await app.page.locator('#update-notice .update-row', { hasText: 'DataLad' }).first().getByRole('button', { name: 'Skip this version' }).click()
    await app.page.waitForFunction(
      () => ![...document.querySelectorAll('#update-notice .update-row')].some((r) => /DataLad/i.test(r.textContent) && r.textContent.includes('99.0.0')),
      undefined,
      { timeout: 10_000 }
    )
  }))

test('with updates disabled nothing is shown and nothing is requested', () =>
  step('Update disabled', async () => {
    const WAIT = 8_000
    requests = 0
    await launch({ env: { DLAD_UPDATE_FEED: feed, DATALAD_DESKTOP_DISABLE_UPDATE_CHECK: '1' } })
    await new Promise((r) => setTimeout(r, WAIT))
    assert.equal(await visible(), false)
    assert.equal(requests, 0)

    // Positive control: the same launch with the switch on makes requests within the same wait, so zero above is not just a slow start.
    await app.close()
    app = null
    await launch({ env: { DLAD_UPDATE_FEED: feed, DATALAD_DESKTOP_DISABLE_UPDATE_CHECK: '0' } })
    await new Promise((r) => setTimeout(r, WAIT))
    assert.ok(requests > 0, 'with the switch off the same wait sees a request')
  }))
