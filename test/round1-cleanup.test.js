import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const html = read('src/gui/renderer/index.html')
const app = read('src/gui/renderer/app.js')

test('Save no longer has manual file paths', () => {
  assert.doesNotMatch(html, /id="paths"/)
  assert.doesNotMatch(html, /manual (file )?paths/i)
  assert.doesNotMatch(app, /elements\.paths|parsePaths|manual paths/)
})

const main = read('src/gui/main.js')
const preload = read('src/gui/preload.js')

test('the console and Power user mode are gone from the UI', () => {
  for (const id of ['power-user-console', 'project-nav-tile-console', 'power-user-mode-toggle', 'console-run', 'console-command']) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`), id)
  }
  assert.doesNotMatch(html, /Power user mode|Power User Console/i)
  assert.doesNotMatch(app, /powerUser|PowerUser|POWER_USER|consoleRunButton|runConsoleCommand|setConsoleEnabled|consoleHistory/)
})

test('the console is gone from the main process, preload and policy', () => {
  assert.doesNotMatch(main, /console:setEnabled|console:runCommand|buildConsoleCommand|createConsoleConsent|consoleEnabled/)
  assert.doesNotMatch(preload, /runConsoleCommand|setConsoleEnabled/)
  for (const file of ['src/datalad/console-command.js', 'src/gui/console-consent.js', 'test/console-command.test.js', 'test/console-consent.test.js', 'e2e/console-gate.e2e.mjs', 'e2e/console-policy.e2e.mjs', 'e2e/cancel.e2e.mjs']) {
    assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), false, file)
  }
})

test('SECURITY.md no longer documents a console', () => {
  assert.doesNotMatch(read('SECURITY.md'), /DISABLE_CONSOLE|consoleDisabled|Command console/)
})

test('ProcessRunner never runs a shell line (that option existed only for the console)', () => {
  const runner = read('src/datalad/process-runner.js')
  assert.doesNotMatch(runner, /options\.shell/)
  assert.match(runner, /shell: false/)
})

test('the UI text says save, never checkpoint or commit', () => {
  // Ids, classes and other attributes are exempt; visible text, titles and placeholders are not.
  const visible = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s(?:id|class|for|aria-labelledby|aria-controls|data-[\w-]+|role|type|href|src|alt)="[^"]*"/g, '')
  assert.doesNotMatch(visible, /checkpoint|\bcommits?\b/i)
})

test('user-facing strings in app.js and the pure helpers say save', () => {
  const chips = read('src/gui/renderer/project-health-chips.js')
  const gating = read('src/gui/renderer/save-gating.js')
  assert.doesNotMatch(app, /Latest commit|Last commit|No commits yet|recent commits'|`checkpoint |Save a Checkpoint|Checkpoint Message|Save Checkpoint|checkpoint message/)
  assert.doesNotMatch(chips + gating, /checkpoint|messageLabel/i)
  assert.match(app, /Last saved \$\{relativeAge\}/)
  assert.match(app, /return `save \$\{date\} \$\{time\}`/)
})

test('the header is slim while a project is open and the last-save line sits in the project strip', () => {
  assert.match(html, /<header id="app-header" class="hero /)
  const strip = html.slice(html.indexOf('id="project-strip"'), html.indexOf('id="running-commands"'))
  assert.match(strip, /id="last-commit-meta"/)
  assert.doesNotMatch(html.slice(0, html.indexOf('id="project-strip"')), /id="last-commit-meta"/)
  const fn = app.slice(app.indexOf('function setProjectDependentSectionsVisible'))
  assert.match(fn.slice(0, fn.indexOf('\n}\n')), /appHeader\.classList\.toggle\('hero-slim', visible\)/)
  assert.match(read('src/gui/renderer/styles.css'), /\.hero-slim h1/)
})
