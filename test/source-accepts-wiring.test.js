import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const main = read('../src/gui/main.js')
const preload = read('../src/gui/preload.js')
const block = (start) => {
  const at = main.indexOf(start)
  assert.ok(at !== -1, `missing ${start}`)
  return main.slice(at, main.indexOf('\n})\n', at))
}

test('setSourceAccepts checks the project first, then validates the answer in main', () => {
  const body = block("handle('adapter:setSourceAccepts'")
  const guard = body.indexOf('requireAuthorizedRoot(payload.projectPath)')
  const check = body.search(/value !== 'yes' && payload\.value !== 'no'|\['yes', 'no'\]\.includes\(payload\.value\)/)
  assert.ok(guard !== -1 && check > guard && check < body.indexOf('adapter.setSourceAccepts('))
})

test('clearSourceAccepts checks the project first and takes no free-text value', () => {
  const body = block("handle('adapter:clearSourceAccepts'")
  assert.ok(body.indexOf('requireAuthorizedRoot(projectPath)') !== -1)
  assert.ok(body.indexOf('requireAuthorizedRoot(') < body.indexOf('adapter.clearSourceAccepts('))
})

test('the page can only ask for yes, no or clearing, through the preload', () => {
  assert.match(preload, /setSourceAccepts: \(projectPath, value\) => ipcRenderer\.invoke\('adapter:setSourceAccepts', \{ projectPath, value \}\)/)
  assert.match(preload, /clearSourceAccepts: \(projectPath\) => ipcRenderer\.invoke\('adapter:clearSourceAccepts', projectPath\)/)
})

const app = read('../src/gui/renderer/app.js')
const handlerOf = (start) => {
  const at = app.indexOf(start)
  assert.ok(at !== -1, `missing ${start}`)
  return app.slice(at, app.indexOf('\n})\n', at))
}

test('the question row is a labelled group of real buttons, with every text escaped', () => {
  const body = app.slice(app.indexOf('function renderAttentionRows'), app.indexOf('function renderProjectHealth'))
  assert.match(body, /role="group" aria-label="\$\{escapeHtml\(row\.groupLabel\)\}"/)
  assert.match(body, /button\(`data-source-answer="\$\{escapeHtml\(answer\.answer\)\}"`, answer\.text\)/)
  assert.match(body, /type="button" \$\{attrs\}>\$\{escapeHtml\(text\)\}<\/button>/)
  assert.match(body, /data-source-undo/)
  assert.match(body, /data-add-remote/)
})

test('Yes and No are stored through the API; Not sure is remembered in memory only', () => {
  const body = handlerOf("elements.attentionRows.addEventListener('click'")
  assert.match(body, /api\.setSourceAccepts\(projectPath, answer\)/)
  assert.match(body, /answer === 'unsure'[\s\S]{0,200}state\.sourceNotSure\.add\(projectPath\)/)
  assert.match(body, /answer === 'yes' \|\| answer === 'no'/)
  assert.match(body, /api\.clearSourceAccepts\(projectPath\)/)
  assert.match(body, /showTools\('sync-data-section'\)/)
  assert.match(body, /elements\.addRemote\.open = true/)
  assert.match(app, /sourceNotSure: new Set\(\)/)
})

test('the status line and rows are built from the health with the session answer applied', () => {
  const body = app.slice(app.indexOf('function renderProjectHealth'), app.indexOf('function chipHtml'))
  assert.match(body, /withSessionAnswer\(state\.projectHealthSnapshot, state\.sourceNotSure\)/)
})

test('Publish learns "does not accept changes" only from a refused push, then says so plainly', () => {
  const body = handlerOf('elements.publishProjectButton.addEventListener')
  const push = body.indexOf("runWorkflowCommand('push'")
  const learn = body.search(/isSourceRefusal\('push', result\)[\s\S]{0,200}api\.setSourceAccepts\(projectPath, 'no'\)/)
  assert.ok(push !== -1 && learn > push)
  assert.match(body, /setLastActionState\(REFUSED_PUBLISH_MESSAGE, 'warning'\)/)
  assert.match(body, /refreshProjectHealth\(projectPath, \{ fresh: true \}\)/)
})

test('the question and read-only buttons are disabled while a command runs; the group label is short', () => {
  const gating = app.slice(app.indexOf('function syncAttentionRowGating'), app.indexOf('function renderAttentionRows'))
  assert.match(gating, /button\[data-source-answer\], button\[data-source-undo\], button\[data-add-remote\]/)
  assert.match(gating, /state\.pendingCommands\.size > 0/)
  const chips = read('../src/gui/renderer/project-health-chips.js')
  assert.match(chips, /groupLabel: 'Can you send changes back\?'/)
})

test('the refusal message is hedged and does not contradict the credentials help', () => {
  const src = read('../src/gui/renderer/source-accepts.js')
  assert.match(src, /Sending your saves was refused\. Either this place does not accept changes from you, or your login is not valid\. If this project came from a public source such as OpenNeuro, add your own remote to share these saves\./)
})

const html = read('../src/gui/renderer/index.html')

test('Setup has a This project section with a labelled select and the plain-words options', () => {
  assert.match(html, /<h3 class="setup-section-title">This project<\/h3>/)
  assert.match(html, /<label[^>]*for="source-accepts-select"[^>]*>\s*Does the place this project came from accept your changes\?/)
  const sel = html.match(/<select[^>]*id="source-accepts-select"[\s\S]*?<\/select>/)?.[0] ?? ''
  assert.match(sel, /value="ask"[^>]*>Ask me when there are unsent saves/)
  assert.match(sel, /value="yes"[^>]*>Yes, I can send my saves there/)
  assert.match(sel, /value="no"[^>]*>No, it is read-only for me/)
  assert.match(html, /Send my saves is always really attempted/)
})

test('Setup writes the answer only through settingAction, then refreshes health', () => {
  const at = app.indexOf("sourceAcceptsSelect.addEventListener('change'")
  assert.ok(at !== -1)
  const body = app.slice(at, app.indexOf('\n})\n', at))
  assert.match(body, /settingAction\(/)
  assert.match(body, /api\.setSourceAccepts\(projectPath, action\.value\)/)
  assert.match(body, /api\.clearSourceAccepts\(projectPath\)/)
  assert.ok(body.indexOf('refreshProjectHealth(projectPath, { fresh: true })') > body.indexOf('api.clearSourceAccepts'))
  assert.match(body, /Saved for this project\./)
  assert.match(body, /readProjectPath\(\)/)
})

test('the Setup control follows the health snapshot when Setup opens and when health renders', () => {
  assert.match(app, /function renderSourceAcceptsSetting\(\)[\s\S]*settingState\(state\.projectHealthSnapshot/)
  const render = app.slice(app.indexOf('function renderProjectHealth'), app.indexOf('function renderProjectHealth') + 600)
  assert.match(render, /renderSourceAcceptsSetting\(\)/)
  const open = app.slice(app.indexOf("elements.openSettingsButton.addEventListener('click'"), app.indexOf('async function refreshGitIdentity'))
  assert.match(open, /renderSourceAcceptsSetting\(\)/)
})

test('actions that change the project refresh health with fresh: true', () => {
  const add = app.slice(app.indexOf("} finally {\n    await refreshProjectHealth"), app.indexOf("} finally {\n    await refreshProjectHealth") + 120)
  assert.match(add, /refreshProjectHealth\(projectPath, \{ fresh: true \}\)/)
  const answers = handlerOf("button[data-source-answer]").length ? app.slice(app.indexOf("const answer = event.target.closest('button[data-source-answer]')"), app.indexOf('function renderSourceAcceptsSetting')) : ''
  assert.match(answers, /refreshProjectHealth\(projectPath, \{ fresh: true \}\)/)
  const setup = app.slice(app.indexOf("sourceAcceptsSelect.addEventListener('change'"), app.indexOf('function attentionTargetButton'))
  assert.match(setup, /refreshProjectHealth\(projectPath, \{ fresh: true \}\)/)
  assert.match(setup, /sourceAcceptsSelect\.disabled = true/)
  assert.match(setup, /finally \{[\s\S]*sourceAcceptsSelect\.disabled = false/)
  assert.match(app, /reusePendingFetch\(\{ pendingPath: state\.pendingHealthFetch\?\.path, projectPath, fresh \}\)/)
})

test('the Setup help says the Send my saves button and the Home view', () => {
  assert.doesNotMatch(html, /Publish bar|Home bar/)
  assert.match(html, /the Send my saves button works as usual/)
})
