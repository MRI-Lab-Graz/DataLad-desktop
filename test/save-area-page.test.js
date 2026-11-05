import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const html = read('src/gui/renderer/index.html')
const app = read('src/gui/renderer/app.js')
const css = read('src/gui/renderer/styles.css')
const panel = /<section id="save-checkpoint-panel"[\s\S]*?<\/section>\s*<\/div>/.exec(html)?.[0] ?? /<section id="save-checkpoint-panel"[\s\S]*?<details id="last-action-details"/.exec(html)?.[0] ?? ''
const at = (text) => panel.indexOf(text)
const fn = (name) => app.slice(app.indexOf(name), app.indexOf(name) + 2600)

test('Save is three steps in order: what changed, is it valid, what did you do and why; then the button', () => {
  assert.ok(panel.length > 0)
  const order = ['id="save-step-changes"', 'id="save-step-valid"', 'id="save-step-message"', 'id="save-project"']
  for (let i = 1; i < order.length; i++) assert.ok(at(order[i - 1]) >= 0 && at(order[i - 1]) < at(order[i]), `${order[i - 1]} before ${order[i]}`)
  assert.match(panel, /What did you do, and why\?/)
  assert.match(panel, /id="save-step-valid"[^>]*hidden/) // only BIDS/PRISM projects have a validity step
  assert.match(panel, /id="save-project"[\s\S]{0,300}Save this step/)
})

test('the validity step has its text, the list of problems and a Check again button', () => {
  for (const id of ['save-validity-text', 'save-validity-problems', 'save-validity-recheck']) assert.ok(at(`id="${id}"`) > at('id="save-step-valid"') && at(`id="${id}"`) < at('id="save-step-message"'), id)
  assert.match(html, /id="save-validity-recheck"[^>]*type="button"/)
})

test('Recent saves are gone from the Save area and from the page code; History stays in Tools', () => {
  assert.doesNotMatch(html, /recent-commits|history-full-link|Recent saves/)
  assert.doesNotMatch(app, /recentCommitsOutput|renderRecentCommitList|refreshRecentCommits|historyFullLink/)
  assert.match(html, /id="time-machine-zone"/)
})

test('the message box has a nudge for vague messages that is only a hint (a tip)', () => {
  assert.match(panel, /id="message-nudge"[^>]*class="[^"]*save-tip/)
  assert.match(app, /vagueMessageNudge\(elements\.message\.value\)/)
  assert.doesNotMatch(fn('function updateSaveButtonState'), /vagueMessageNudge[\s\S]{0,80}disabled/)
})

test('tips can be switched off in Setup (default on, remembered here); only tips disappear', () => {
  assert.match(html, /<input[^>]*id="save-tips-toggle"[^>]*role="switch"[^>]*checked/)
  assert.match(app, /dataladDesktop\.saveTips/)
  assert.match(app, /classList\.toggle\('save-tips-off'/)
  assert.match(css, /\.save-tips-off\s+\.save-tip\s*\{\s*display:\s*none/)
  for (const id of ['save-step-valid', 'save-validity-recheck', 'message', 'save-project', 'save-guidance']) {
    assert.ok(!new RegExp(`id="${id}"[^>]*class="[^"]*save-tip`).test(html), `${id} is not a tip`)
  }
})

test('the validity step shows the check result with textContent, is marked old when the files changed, and Check again re-runs it', () => {
  const result = fn('function currentSaveValidity')
  assert.match(result, /describeSaveValidity\(\{ check: state\.rootProjectCheck, stale \}\)/)
  assert.match(result, /changeSignature\(snapshot\.files\)/)
  assert.doesNotMatch(fn('function renderSaveValidity'), /innerHTML/)
  assert.match(app, /saveValidityRecheck\.addEventListener\('click', \(\) => void refreshValidity\(state\.rootProjectPath\)\)/)
  assert.match(app, /rootProjectCheckedSignature = state\.workingTreeSnapshot/) // remembered when the check finishes
})

test('a fresh "not valid" holds Save back; clicking a badge goes to the validity step', () => {
  assert.match(fn('function updateSaveButtonState'), /validityBlocked:/)
  assert.match(app, /badge\.addEventListener\('click'[\s\S]{0,200}saveStepValid\.scrollIntoView/)
})

test('the check refreshes the list of changed files before it remembers it, so a fresh result is never shown as old', () => {
  const body = app.slice(app.indexOf('async function refreshValidity('), app.indexOf('function renderValidity('))
  const refresh = body.indexOf('await refreshWorkingTreeStatus(projectPath)')
  assert.ok(refresh > 0 && refresh < body.indexOf('rootProjectCheckedSignature ='), 'status refreshed first')
  assert.match(body.slice(refresh, body.indexOf('rootProjectCheckedSignature =')), /runId !== validityRunId/) // still the newest run after waiting
})
