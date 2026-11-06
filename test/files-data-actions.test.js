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

test('the old Get Data / Free Up Space / Unlock buttons are gone from the page and the script', () => {
  for (const id of ['get-data', 'drop-data', 'unlock-files', 'unlock-info']) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`), id)
  }
  for (const name of ['getDataButton', 'dropDataButton', 'unlockFilesButton']) {
    assert.doesNotMatch(app, new RegExp(name), name)
  }
})

test('the tab is called Sync and no longer mentions file content', () => {
  const tile = between(html, 'id="project-nav-tile-sync"', '</button>')
  assert.match(tile, /<span class="onboarding-tile-label">Sync<\/span>/)
  const section = between(html, 'id="sync-data-section"', 'id="files-panel"')
  assert.match(section, /<h2 id="sync-data-title">Sync<\/h2>/)
  assert.doesNotMatch(section, /Get Data|Manual File Paths|Unlock/)
})

// ---- Choose data panel ----
const css = read('styles.css')

test('Files panel has a collapsible Choose data section, hidden until the app knows it is BIDS', () => {
  const panel = between(html, 'id="files-panel"', 'id="project-health-panel"')
  assert.match(panel, /<details id="data-panel-section"[^>]*\shidden/)
  assert.match(panel, /id="data-panel-body"/)
  assert.match(app, /data-panel-section/)
  const vis = between(app, 'function updateDataPanelVisibility', '\n}\n')
  assert.match(vis, /state\.rootProjectIsBids/)
  assert.match(vis, /state\.rootProjectPath/)
})

test('the delete-without-check dialog is separate, plain, and asks for a typed word', () => {
  const dialog = between(html, 'id="reckless-overlay"', 'id="global-busy-overlay"')
  assert.match(dialog, /<form id="reckless-form"[^>]*role="dialog"/)
  assert.match(dialog, /id="reckless-word"[^>]*type="text"/)
  assert.match(dialog, /id="reckless-confirm"[^>]*disabled/)
  assert.match(dialog, /another copy exists/)
  assert.match(dialog, /gone for good/)
  const panel = between(html, 'id="data-panel-section"', 'id="project-health-panel"')
  assert.match(panel, /id="data-reckless-open"[^>]*>Delete without a safety check…</)
  assert.doesNotMatch(panel, /id="reckless-form"/) // never inside the Free up click
})

test('app.js wires the panel to the pure modules and runs both buttons through runSelectedBatches', () => {
  assert.match(app, /from '\.\/data-panel\.js'/)
  assert.match(app, /from '\.\/data-selection\.js'/)
  assert.match(app, /from '\.\/data-actions\.js'/)
  assert.match(app, /api\.listDataFiles\(/)
  assert.match(app, /renderDataPanel\(/)
  const run = between(app, 'async function runDataPanelAction', '\n}\n')
  assert.match(run, /runSelectedBatches\(/)
  assert.match(run, /runWorkflowCommand\(mode/)
  assert.match(run, /shouldStop: shouldStopSequence/)
  assert.match(run, /needsRecklessOffer\(/)
  assert.doesNotMatch(run, /dropReckless/) // the normal path never reaches it
})

test('dropReckless runs only from the dialog submit, after the typed word, on the failed paths only', () => {
  const calls = app.match(/dropReckless/g) ?? []
  assert.equal(calls.length, 1)
  const submit = between(app, 'async function runRecklessDrop', '\n}\n')
  assert.match(submit, /dropReckless/)
  assert.ok(submit.indexOf('isDeleteWord(') < submit.indexOf('runSelectedBatches('))
  assert.match(submit, /const paths = \[\.\.\.state\.dataPanel\.unsafePaths\]/)
  assert.match(submit, /^\s+paths,$/m)
  assert.doesNotMatch(submit, /files,|selection/) // never re-plans from the selection
  assert.ok(submit.indexOf('closeRecklessDialog()') < submit.indexOf('runSelectedBatches('))
  assert.match(between(app, 'function closeRecklessDialog', '\n}\n'), /elements\.recklessWord\.value = ''/)
  assert.match(app, /elements\.recklessForm\.addEventListener\('submit'/)
})

test('the Free up path offers the reckless dialog only after a failed normal drop', () => {
  const run = between(app, 'async function runDataPanelAction', '\n}\n')
  assert.match(run, /mode === 'drop' && needsRecklessOffer\(/)
})

test('Get all confirms first, with the file count and size', () => {
  const run = between(app, 'async function runDataAction', '\n}\n')
  assert.match(run, /action === 'get' && paths\.length === 0/)
  assert.ok(run.indexOf('window.confirm') < run.indexOf('runWorkflowCommand(action,'))
  assert.match(run, /listDataFiles/)
})

test('the panel buttons are gated while a command runs', () => {
  assert.match(app, /computeDataPanelGating\(/)
  const busy = between(app, 'function setButtonBusy', '\n}\n')
  assert.match(busy, /updateDataPanelButtons\(\)/)
})

test('panel styles exist', () => {
  assert.match(css, /\.data-panel/)
})

// ---- review fixes ----
test('both panel runners refuse when the panel belongs to another project', () => {
  for (const fn of ['async function runDataPanelAction', 'async function runRecklessDrop']) {
    const body = between(app, fn, '\n}\n')
    assert.match(body, /panelMatchesProject\(state\.dataPanel, (projectPath|state\.rootProjectPath)\)/, fn)
    assert.ok(body.indexOf('panelMatchesProject(') < body.indexOf('runSelectedBatches('), fn)
  }
})

test('switching project resets the panel, the offer and the delete dialog', () => {
  const reset = between(app, 'function resetDataPanel', '\n}\n')
  assert.match(reset, /unsafePaths: \[\]/)
  assert.match(reset, /closeRecklessDialog\(\)/)
  assert.match(reset, /dataRecklessOffer\.hidden = true/)
  assert.match(between(app, 'async function detectProjectType', '\n}\n'), /resetDataPanel\(\)/)
})

test('only refused paths feed the delete dialog, with the plain messages from data-actions', () => {
  const run = between(app, 'async function runDataPanelAction', '\n}\n')
  assert.match(run, /unsafePaths = outcome\.failedPaths/)
  assert.doesNotMatch(run, /unsafePaths = \[\.\.\./)
  assert.match(run, /describeNotRemoved\(outcome\)/)
  assert.match(app, /describeRecklessDialog\(/)
  assert.match(run, /onProgress/)
})

test('Get all on a BIDS project goes through the batch runner with the exact plan', () => {
  const run = between(app, 'async function runDataAction', '\n}\n')
  assert.match(run, /state\.rootProjectIsBids/)
  assert.match(run, /planGetAll\(/)
  assert.match(run, /describeGetAll\(/)
  assert.match(run, /runSelectedBatches\(/)
  assert.ok(run.indexOf('window.confirm') < run.indexOf('runSelectedBatches('))
})
