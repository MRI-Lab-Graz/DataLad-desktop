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
  const learn = body.search(/isPushRefusal\('push', result\)[\s\S]{0,200}api\.setSourceAccepts\(projectPath, 'no'\)/)
  assert.ok(push !== -1 && learn > push)
  assert.match(body, /setLastActionState\(REFUSED_PUBLISH_MESSAGE, 'warning'\)/)
  assert.match(body, /refreshProjectHealth\(projectPath\)/)
})
