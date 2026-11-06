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
  assert.match(render, /rowDataActions\(node, \{ hasRemote \}\)/)
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

import { GET_DATA_READY_TITLE, FREE_UP_SPACE_TITLE, computeDatasetGating, computeAnnexToolGating } from '../src/gui/renderer/button-gating.js'

test('every Files toolbar button explains itself on hover, in plain words', () => {
  const panel = between(html, 'id="files-panel"', 'id="project-health-panel"')
  const title = (id) => new RegExp(`<button id="${id}"[^>]*\\stitle="([^"]+)"`).exec(panel)?.[1] ?? ''
  assert.match(title('open-active-folder'), /file manager|Explorer|Finder/i)
  assert.match(title('refresh-files'), /reload/i)
  for (const text of [GET_DATA_READY_TITLE, FREE_UP_SPACE_TITLE]) {
    assert.ok(text.length > 40, 'a full sentence')
    assert.doesNotMatch(text, /annex|placeholder|checksum|sibling|datalad/i, 'no jargon')
  }
  assert.match(GET_DATA_READY_TITLE, /not (yet )?on this computer/i)
  assert.match(FREE_UP_SPACE_TITLE, /safely stored (somewhere else|elsewhere)/i)
  assert.match(FREE_UP_SPACE_TITLE, /download (them|it) again/i)
  assert.match(app, /computeAnnexToolGating\(\s*state\.currentProjectClassification,\s*FREE_UP_SPACE_TITLE/)
})

test('the reasons a Files button is switched off are also plain words', () => {
  const reasons = [
    computeDatasetGating('git').title,
    computeDatasetGating('dataset', { annexSupported: true, missingContentCount: 0 }).title,
    computeAnnexToolGating('git', 'x').title
  ]
  for (const text of reasons) assert.doesNotMatch(text, /annex|tracked|datalad|dataset/i, text)
})

test('the toolbar hides Get all and Free up space (all) by the same rule the page uses', () => {
  assert.match(app, /filesToolbarVisibility\(state\.projectHealthSnapshot, state\.currentProjectClassification\)/)
  assert.match(app, /filesGetAllButton\.hidden\s*=\s*!/)
  assert.match(app, /filesFreeAllButton\.hidden\s*=\s*!/)
})

test('file rows are rebuilt when the remote becomes known after they were drawn', () => {
  const render = between(app, 'function renderFileTreeNodes', 'function renderGitStatusBadge')
  assert.match(render, /state\.fileRowsHaveRemote\s*=\s*hasRemote/)
  const health = between(app, 'state.projectHealthSnapshot = health', 'return health')
  assert.match(health, /state\.fileRowsHaveRemote\s*!==\s*Boolean\(health\.hasUpstream\)[\s\S]{0,120}refreshFileBrowser\(projectPath\)/)
})
