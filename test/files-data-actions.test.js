import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../src/gui/renderer/${p}`, import.meta.url), 'utf8')
const html = read('index.html')
const app = read('app.js')
const between = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)))

test('the Files toolbar has Get all and Free up space (all)', () => {
  const panel = between(html, 'id="files-panel"', 'id="project-health-panel"')
  assert.match(panel, /id="files-get-all"/)
  assert.match(panel, /id="files-free-all"/)
})

test('file rows render their data actions from rowDataActions, with an escaped path', () => {
  assert.match(app, /import \{ rowDataActions \} from '\.\/row-data-actions\.js'/)
  const render = between(app, 'function renderFileTreeNodes', 'function renderGitStatusBadge')
  assert.match(render, /rowDataActions\(node\)/)
  assert.match(render, /data-data-path="\$\{escapeHtml\(node\.relativePath\)\}"/)
})

test('data actions run against the browsed project, as one path each, with their confirmations', () => {
  const run = between(app, 'async function runDataAction', '\n}\n')
  assert.match(run, /state\.fileBrowserProject/)
  assert.match(run, /relativePath \? \[relativePath\] : \[\]/)
  assert.match(run, /runWorkflowCommand\(action,/)
  assert.match(run, /window\.confirm/)
})

test('a click on a row action does not also toggle the folder it sits in', () => {
  const handler = app.slice(app.indexOf("closest('[data-data-action]')"))
  assert.match(handler.slice(0, 400), /event\.preventDefault\(\)/)
})

test('the toolbar buttons are gated with the existing rules', () => {
  const gating = between(app, 'function updateGetDataGating', 'function updateSyncSectionVisibility')
  assert.match(gating, /filesGetAllButton\.disabled = gating\.disabled/)
  assert.match(gating, /filesFreeAllButton\.disabled = dropGating\.disabled/)
})
