import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describeFolders, describeTypeBadge, describeValidity } from '../src/gui/renderer/project-card.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const html = read('src/gui/renderer/index.html')
const app = read('src/gui/renderer/app.js')
const ds = (...paths) => ['.', ...paths].map((relativePath) => ({ relativePath }))
const subs = (n) => Array.from({ length: n }, (_, i) => `sub-${String(i + 1).padStart(2, '0')}`)

// --- folder line ---

test('a BIDS/PRISM project names its subject folders and says each is tracked on its own', () => {
  assert.equal(describeFolders(ds(...subs(43)), { bidsLike: true }), '43 subject folders, each tracked on its own')
  assert.equal(describeFolders(ds('sub-01'), { bidsLike: true }), '1 subject folder, tracked on its own')
})

test('other top-level folders that are tracked on their own are named after the subjects', () => {
  assert.equal(
    describeFolders(ds(...subs(2), 'derivatives', 'sourcedata'), { bidsLike: true }),
    '2 subject folders, each tracked on its own. Also on their own: derivatives, sourcedata'
  )
  assert.equal(describeFolders(ds('derivatives'), { bidsLike: true }), 'Contains 1 separately tracked folder: derivatives')
})

test('a project that is not BIDS/PRISM, or has no subjects, says "separately tracked folders" (no jargon)', () => {
  assert.equal(describeFolders(ds('a', 'b'), { bidsLike: false }), 'Contains 2 separately tracked folders')
  assert.equal(describeFolders(ds('sub-01', 'sub-02'), { bidsLike: false }), 'Contains 2 separately tracked folders')
  assert.equal(describeFolders(ds('x'), { bidsLike: false }), 'Contains 1 separately tracked folder')
})

test('nothing nested, no project, or only the root: no line; deeper folders are not counted as subjects', () => {
  assert.equal(describeFolders([], { bidsLike: true }), '')
  assert.equal(describeFolders(undefined, { bidsLike: true }), '')
  assert.equal(describeFolders(ds(), { bidsLike: true }), '')
  assert.equal(describeFolders(ds('sub-01', 'sub-01/ses-1'), { bidsLike: true }), '1 subject folder, tracked on its own')
})

test('more than three other folders are cut short', () => {
  assert.match(describeFolders(ds('sub-01', 'a', 'b', 'c', 'd'), { bidsLike: true }), /Also on their own: a, b, c and 1 more$/)
})

// --- type badge ---

test('only a plain Git folder (or an unknown one) gets a type badge; DataLad projects show none', () => {
  assert.equal(describeTypeBadge('git').hidden, false)
  assert.equal(describeTypeBadge('git').text, 'Git')
  assert.match(describeTypeBadge('git').title, /data on demand/i)
  for (const c of ['dataset', 'superdataset']) assert.equal(describeTypeBadge(c).hidden, true)
  assert.equal(describeTypeBadge('dataset').text, 'DataLad')
  assert.equal(describeTypeBadge('superdataset').text, 'DataLad') // no more "DataLad + Links"
  assert.equal(describeTypeBadge(undefined).text, 'Unknown')
})

// --- validity badge ---

test('validity: valid, invalid, checking and not checked, each with plain words', () => {
  assert.deepEqual(describeValidity({ label: 'PRISM', check: { verdict: 'valid' } }), { text: 'PRISM ✓ valid', tone: 'ok', title: 'Checked with the validator: no problems found.' })
  assert.equal(describeValidity({ label: 'BIDS', check: { verdict: 'invalid', errorCount: 3 } }).text, 'BIDS ✗ 3 problems')
  assert.equal(describeValidity({ label: 'BIDS', check: { verdict: 'invalid', errorCount: 1 } }).text, 'BIDS ✗ 1 problem')
  assert.equal(describeValidity({ label: 'BIDS', check: { verdict: 'invalid', errorCount: 0 } }).text, 'BIDS ✗ not valid')
  assert.equal(describeValidity({ label: 'PRISM', check: { verdict: 'checking' } }).text, 'PRISM · checking…')
  const missing = describeValidity({ label: 'PRISM', check: { verdict: 'unchecked', reason: 'validator-missing' } })
  assert.equal(missing.text, 'PRISM · not checked')
  assert.match(missing.title, /Setup/)
  assert.equal(describeValidity({ label: 'PRISM', check: { verdict: 'unchecked', reason: 'failed' } }).tone, 'unknown')
})

test('validity: no result yet, or a nonsense one, never reads as valid', () => {
  for (const check of [null, undefined, {}, { verdict: 'VALID' }, { verdict: 'valid-ish' }, 'valid']) {
    const out = describeValidity({ label: 'PRISM', check })
    assert.equal(out.text, 'PRISM', JSON.stringify(check))
    assert.equal(out.tone, 'unknown')
  }
  assert.equal(describeValidity({ label: 'PRISM', check: { verdict: 'invalid', errorCount: '<b>9</b>' } }).text, 'PRISM ✗ not valid')
})

// --- markup ---

test('Switch Project is the first button in the header, left of Setup', () => {
  const header = /<header id="app-header"[\s\S]*?<\/header>/.exec(html)?.[0] ?? ''
  const actions = /class="hero-actions"[\s\S]*?id="open-docs"/.exec(header)?.[0] ?? ''
  assert.ok(actions.indexOf('id="switch-project"') >= 0, 'Switch Project is in the header actions')
  assert.ok(actions.indexOf('id="switch-project"') < actions.indexOf('id="open-settings"'), 'before Setup')
  assert.ok(!/<section id="project-strip"[\s\S]*?id="switch-project"[\s\S]*?<\/section>/.test(html), 'no longer in the project card')
})

test('the project card has a "project" part and a "right now" part, with Tools as a main button', () => {
  const strip = /<section id="project-strip"[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''
  const about = strip.indexOf('id="project-strip-about"')
  const now = strip.indexOf('id="project-strip-now"')
  assert.ok(about >= 0 && now > about, 'two parts, project first')
  for (const id of ['current-project-title', 'current-project-path', 'current-project-nested-info', 'current-project-badge', 'current-project-bids-badge', 'current-project-prism-badge']) {
    assert.ok(strip.indexOf(`id="${id}"`) > about && strip.indexOf(`id="${id}"`) < now, `${id} is in the project part`)
  }
  for (const id of ['project-status-line', 'last-commit-meta', 'last-action-state', 'validity-details']) {
    assert.ok(strip.indexOf(`id="${id}"`) > now, `${id} is in the right-now part`)
  }
  const tools = /<button id="open-tools"[^>]*>[\s\S]*?<\/button>/.exec(strip)?.[0] ?? ''
  assert.match(tools, /Work on this project/)
  assert.match(tools, /button-primary/)
  assert.match(tools, /aria-controls="project-tools"[^>]*aria-expanded="false"|aria-expanded="false"[^>]*aria-controls="project-tools"/)
})

test('the BIDS and PRISM badges are buttons that open the problem list; the list has a Check again button', () => {
  assert.match(html, /<button[^>]*id="current-project-bids-badge"/)
  assert.match(html, /<button[^>]*id="current-project-prism-badge"/)
  assert.match(html, /id="validity-recheck"/)
})

// --- wiring ---

test('the check runs when a project is opened and after a Save, cancels the one before, and shows text with textContent only', () => {
  assert.match(app, /async function refreshValidity\(/)
  const body = app.slice(app.indexOf('async function refreshValidity('), app.indexOf('async function refreshValidity(') + 2500)
  assert.match(body, /api\.cancelCommand\(/)
  assert.match(body, /api\.checkPrism\(projectPath, runId\)/)
  assert.match(body, /projectPath !== state\.rootProjectPath/)
  assert.doesNotMatch(body, /innerHTML/)
  assert.match(app, /void refreshValidity\(projectPath\)/) // on open
  assert.match(app, /commandName === 'save'[^\n]*refreshValidity\(nextProjectPath\)/) // after a Save, also a blocked one
})

test('when the check could not run, the details box explains why instead of listing problems to fix', () => {
  const body = app.slice(app.indexOf('function renderValidity('), app.indexOf('function renderValidity(') + 1800)
  assert.match(body, /check\?\.verdict === 'unchecked'[\s\S]{0,200}out\.title|out\.title[\s\S]{0,200}'unchecked'/)
  assert.match(body, /Why wasn't it checked\?/)
})

test('the project type texts no longer say "linked data" or "child data folders"', () => {
  const body = app.slice(app.indexOf('function friendlyProjectTypeLabel('), app.indexOf('function renderProjectCheckOutput('))
  assert.doesNotMatch(body, /linked|child/i)
  assert.match(body, /tracked on their own/)
})
