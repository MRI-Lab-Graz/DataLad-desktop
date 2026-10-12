import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../src/gui/renderer/index.html', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/gui/renderer/app.js', import.meta.url), 'utf8')
const at = (needle) => {
  const index = html.indexOf(needle)
  assert.notEqual(index, -1, `missing in index.html: ${needle}`)
  return index
}

test('Home holds Save; Tools holds every other panel', () => {
  const tools = at('id="project-tools"')
  assert.ok(at('id="project-home"') < at('id="save-checkpoint-panel"'))
  assert.ok(at('id="save-checkpoint-panel"') < tools, 'Save is on Home, before the Tools view')
  for (const id of ['power-user-console', 'sync-data-section', 'files-panel', 'project-health-panel', 'project-setup-zone', 'time-machine-zone']) {
    assert.ok(at(`id="${id}"`) > tools, `${id} is inside Tools`)
  }
})

test('Tools is hidden by default and has open and back buttons', () => {
  assert.match(html, /id="project-tools"[^>]*\bhidden\b/)
  at('id="open-tools"')
  at('id="close-tools"')
})

test('the Save tile is gone and the list items are renamed', () => {
  assert.doesNotMatch(html, /data-nav-target="save-checkpoint-panel"/)
  assert.doesNotMatch(html, /id="save-checkpoint-panel"[^>]*role="tabpanel"/)
  for (const label of ['Files', 'Sync', 'History', 'Health', 'Branches &amp; Ignore', 'Console']) {
    assert.match(html, new RegExp(`<span class="onboarding-tile-label">${label}</span>`), label)
  }
})

test('the project tool selection always falls back to Files, never to Save', () => {
  assert.doesNotMatch(app, /selectProjectTile\('save-checkpoint-panel'\)/)
  assert.match(app, /const DEFAULT_TOOL = 'files-panel'/)
  assert.match(app, /wireTileGroup\(elements\.projectNavTiles, 'navTarget', \{ required: true \}\)/)
})

const fnBody = (name) => {
  const rest = app.slice(app.indexOf(name))
  return rest.slice(0, rest.indexOf('\n}\n'))
}

test('opening a different project returns to Home, but re-rendering the same project keeps Tools open', () => {
  const header = fnBody('function setCurrentProjectHeader')
  assert.match(header, /projectPath !== state\.headerProjectPath/)
  assert.match(header, /showHome\(\)/)
  assert.doesNotMatch(fnBody('function setProjectDependentSectionsVisible'), /showHome\(\)/)
})

test('History never shows another project, and Full history refreshes it', () => {
  assert.match(fnBody('async function loadTimeMachineIfEmpty'), /state\.timeMachineProjectPath === projectPath/)
  assert.match(fnBody('function showTools'), /refreshTimeMachineHistory\(readProjectPath\(\)\)/)
})

test('the health status line lives in the project strip and the Health card is gone', () => {
  const strip = html.slice(at('id="project-strip"'), at('id="running-commands"'))
  assert.match(strip, /id="project-status-line"/)
  assert.doesNotMatch(html, /id="project-health-card"/)
  assert.doesNotMatch(app, /projectHealthCard/)
})

test('Home order: merge banner, attention rows, Save, then recent history', () => {
  assert.ok(at('id="merge-banner"') < at('id="attention-rows"'))
  assert.ok(at('id="attention-rows"') < at('id="save-project"'))
  assert.ok(at('id="save-project"') < at('id="recent-commits-output"'))
  assert.ok(at('id="merge-banner"') < at('id="project-tools"'))
})

test('Home cards carry no emoji badge', () => {
  const home = html.slice(at('id="project-home"'), at('id="project-tools"'))
  assert.doesNotMatch(home, /card-icon-badge/)
})

test('Full history jumps to Tools, History', () => {
  at('id="history-full-link"')
  assert.match(app, /historyFullLink\.addEventListener\('click', \(\) => showTools\('time-machine-zone'\)\)/)
})

test('attention rows come from computeAttentionRows and act through the existing buttons', () => {
  assert.match(app, /computeAttentionRows\(health\)/)
  assert.match(app, /missing: elements\.filesGetAllButton/)
  assert.match(app, /publish: elements\.publishProjectButton/)
  assert.match(app, /update: elements\.updateProjectButton/)
  assert.match(app, /button\.disabled/)
})

test('the last action result is collapsed but opens itself when something is written', () => {
  at('id="last-action-details"')
  assert.match(app, /new MutationObserver\(/)
  assert.match(app, /\.observe\(elements\.commandOutput/)
})

test('the Tools list is a vertical tablist with arrow-key movement', () => {
  assert.match(html, /class="[^"]*tools-nav"[^>]*aria-orientation="vertical"/)
  const wire = fnBody('function wireTileGroup')
  assert.match(wire, /addEventListener\('keydown'/)
  assert.match(wire, /nextTabIndex\(/)
  // With nothing selected (onboarding picker closed) every tile must stay reachable by Tab.
  assert.match(wire, /tabIndex = isSelected \|\| !anySelected \? 0 : -1/)
})

test('the Tools button is a toggle that announces its state', () => {
  assert.match(html, /id="open-tools"[^>]*aria-controls="project-tools"[^>]*aria-expanded="false"/)
  assert.match(fnBody('function showTools'), /setAttribute\('aria-expanded', 'true'\)/)
  assert.match(fnBody('function showHome'), /setAttribute\('aria-expanded', 'false'\)/)
  assert.match(app, /openToolsButton\.addEventListener\('click', \(\) => \(elements\.projectTools\.hidden \? showTools\(\) : showHome\(\{ focus: true \}\)\)\)/)
})

test('focus follows the view swap', () => {
  assert.match(fnBody('function showTools'), /\.focus\(\)/)
  assert.match(fnBody('function showHome'), /if \(focus\)/)
  assert.match(app, /closeToolsButton\.addEventListener\('click', \(\) => showHome\(\{ focus: true \}\)\)/)
})

test('decorative arrows are hidden from screen readers', () => {
  for (const id of ['open-tools', 'close-tools', 'history-full-link']) {
    const button = html.slice(at(`id="${id}"`), html.indexOf('</button>', at(`id="${id}"`)))
    assert.doesNotMatch(button.replace(/<span aria-hidden="true">[←▸]<\/span>/g, ''), /[←▸]/, id)
  }
})

test('tool panels carry no emoji badge and History is called History', () => {
  assert.doesNotMatch(html.slice(at('id="project-tools"')), /card-icon-badge/)
  assert.match(html, /<h2 id="time-machine-title">History — Browse &amp; Restore Past Saves<\/h2>/)
})

test('attention rows follow busy state of the buttons they mirror', () => {
  // Synced in place, not re-rendered: re-rendering would drop focus from the row button just clicked.
  assert.match(fnBody('function setButtonBusy'), /syncAttentionRowGating\(\)/)
  assert.doesNotMatch(fnBody('function setButtonBusy'), /renderAttentionRows/)
})

test('file-watch refreshes keep the folder the file browser shows (not the root)', () => {
  assert.doesNotMatch(app, /refreshFileBrowser\(state\.rootProjectPath\)/)
})

test('no dead Sync hint, and attention rows use one delegated click listener', () => {
  assert.doesNotMatch(html, /sync-data-summary-hint/)
  assert.doesNotMatch(app, /syncDataSummaryHint/)
  assert.match(app, /elements\.attentionRows\.addEventListener\('click'/)
  assert.doesNotMatch(fnBody('function renderAttentionRows'), /addEventListener/)
})
