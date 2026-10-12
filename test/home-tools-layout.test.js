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

test('opening or switching a project returns to Home', () => {
  const fn = app.slice(app.indexOf('function setProjectDependentSectionsVisible'))
  assert.match(fn.slice(0, fn.indexOf('\n}\n')), /showHome\(\)/)
})
