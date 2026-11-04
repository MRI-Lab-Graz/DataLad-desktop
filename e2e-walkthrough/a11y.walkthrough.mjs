// Accessibility checks on the real app: what a keyboard or screen-reader user depends on.
// Not tied to a tutorial (the coverage guard only counts files named NN-*.walkthrough.mjs).
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { launchApp } from '../e2e/electron-driver.mjs'
import { createTempRoot } from '../e2e/fixtures.mjs'
import { removeTree, requireTools, stepRunner } from './harness.mjs'

requireTools()

let app
let root
let project
const step = stepRunner({
  getPage: () => app?.page,
  outDir: join(fileURLToPath(new URL('..', import.meta.url)), 'walkthrough-failures')
})

test.before(async () => {
  root = await createTempRoot()
  project = join(root, 'study')
  const gitConfig = join(root, 'gitconfig')
  await writeFile(gitConfig, '[user]\n\tname = A11y Check\n\temail = a11y@example.org\n')
  execFileSync('datalad', ['create', '-c', 'text2git', project], { env: { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' } })
  app = await launchApp({ trustedPaths: [project] })
  await app.openProject(project)
})

test.after(async () => {
  await app?.close()
  if (root) await removeTree(root)
})

test('Accessibility · the result of an action is announced to screen readers', () =>
  step('Accessibility · result announced', async () => {
    const live = await app.page.evaluate(() => {
      const el = document.getElementById('command-output')
      return el.getAttribute('aria-live') ?? el.getAttribute('role')
    })
    assert.match(String(live), /^(polite|assertive|status|alert)$/, 'Last Action Result must be a live region')
  }))

test('Accessibility · the project title box has a name for screen readers', () =>
  step('Accessibility · title box named', async () => {
    const name = await app.page.evaluate(() => {
      const el = document.getElementById('current-project-title-input')
      const by = el.getAttribute('aria-labelledby')
      return (el.getAttribute('aria-label') || (by && document.getElementById(by)?.textContent) || el.labels?.[0]?.textContent || '').trim()
    })
    assert.notEqual(name, '', 'the title box has only a placeholder')
  }))

test('Accessibility · Run & record keeps keyboard focus inside, Escape closes it, focus goes back', () =>
  step('Accessibility · dialog focus', async () => {
    const page = app.page
    await page.click('#open-tools')
    await page.click('[data-nav-target="time-machine-zone"]')
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Run & record/i.test(b.textContent) && b.offsetParent), null, { timeout: 30_000 })
    const opener = await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Run & record/i.test(b.textContent))?.id)
    assert.ok(opener, 'could not find the Run & record button')
    await page.focus(`#${opener}`)
    await page.keyboard.press('Enter')
    await page.waitForSelector('#run-form', { state: 'visible' })
    for (let i = 0; i < 16; i += 1) {
      await page.keyboard.press('Tab')
      const inside = await page.evaluate(() => !!document.activeElement?.closest('#run-form'))
      assert.ok(inside, `Tab ${i + 1} moved focus out of the dialog`)
    }
    await page.keyboard.press('Shift+Tab')
    assert.ok(await page.evaluate(() => !!document.activeElement?.closest('#run-form')), 'Shift+Tab moved focus out of the dialog')
    await page.keyboard.press('Escape')
    await page.waitForSelector('#run-form', { state: 'hidden' })
    assert.equal(await page.evaluate(() => document.activeElement?.id), opener, 'focus did not return to the button that opened the dialog')
  }))

test('Accessibility · the name-and-email dialog keeps keyboard focus inside and gives it back', () =>
  step('Accessibility · identity dialog focus', async () => {
    const page = app.page
    // The driver leaves Setup open at launch; make sure the Set… button is reachable.
    if (await page.isHidden('#identity-open')) await page.click('#open-settings')
    await page.focus('#identity-open')
    await page.keyboard.press('Enter')
    await page.waitForSelector('#identity-overlay', { state: 'visible' })
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press('Tab')
      assert.ok(await page.evaluate(() => !!document.activeElement?.closest('#identity-overlay')), `Tab ${i + 1} moved focus out of the dialog`)
    }
    await page.keyboard.press('Escape')
    await page.waitForSelector('#identity-overlay', { state: 'hidden' })
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'identity-open')
  }))

test('Accessibility · the brand colour reaches 4.5:1 for small text and primary buttons', () =>
  step('Accessibility · amber contrast', async () => {
    const ratios = await app.page.evaluate(() => {
      const channel = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
      const lum = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
      const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number)
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
      const amber = rgb(getComputedStyle(document.documentElement).getPropertyValue('--teal').trim().replace(/^#(..)(..)(..)$/, (_, r, g, b) => `rgb(${parseInt(r, 16)},${parseInt(g, 16)},${parseInt(b, 16)})`))
      const button = document.querySelector('.button-primary')
      return {
        amberOnWhite: ratio(amber, [255, 255, 255]),
        buttonText: button ? ratio(rgb(getComputedStyle(button).color), amber) : null
      }
    })
    assert.ok(ratios.amberOnWhite >= 4.5, `amber on white is ${ratios.amberOnWhite.toFixed(2)}:1`)
    assert.ok(ratios.buttonText === null || ratios.buttonText >= 4.5, `button text on amber is ${ratios.buttonText?.toFixed(2)}:1`)
  }))
