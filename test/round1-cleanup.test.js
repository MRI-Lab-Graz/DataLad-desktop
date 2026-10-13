import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

// LF endings, so slicing on "\n}\n" also works on a Windows (CRLF) checkout.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
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

// e2e/cancel.e2e.mjs was deleted with the console and is back (round 4), now driven by Run & record.
test('the console is gone from the main process, preload and policy', () => {
  assert.doesNotMatch(main, /console:setEnabled|console:runCommand|buildConsoleCommand|createConsoleConsent|consoleEnabled/)
  assert.doesNotMatch(preload, /runConsoleCommand|setConsoleEnabled/)
  for (const file of ['src/datalad/console-command.js', 'src/gui/console-consent.js', 'test/console-command.test.js', 'test/console-consent.test.js', 'e2e/console-gate.e2e.mjs', 'e2e/console-policy.e2e.mjs']) {
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
})

test('the header is slim while a project is open and the last-save line sits in the project strip', () => {
  assert.match(html, /<header id="app-header" class="hero /)
  const strip = html.slice(html.indexOf('id="project-strip"'), html.indexOf('id="running-commands"'))
  assert.match(strip, /id="last-commit-meta"/)
  assert.doesNotMatch(html.slice(0, html.indexOf('id="project-strip"')), /id="last-commit-meta"/)
  assert.match(read('src/gui/renderer/styles.css'), /\.hero-slim h1/)
})

test('the message suggestion is wired as a placeholder and a Use suggestion button', () => {
  assert.match(html, /id="use-suggestion"[^>]*hidden/)
  assert.match(app, /import \{ suggestMessage \} from '\.\/message-suggestion\.js'/)
  assert.match(app, /elements\.message\.placeholder = suggestion \|\| 'Describe what you changed'/)
  assert.match(app, /elements\.useSuggestionButton\.addEventListener\('click'/)
  // The suggestion reaches the message only through the user's click on the button.
  assert.doesNotMatch(app, /message: suggest|\|\| suggestion\b.*message/)
})

test('the start screen offers one big Continue button for the most recent project', () => {
  const group = html.slice(html.indexOf('id="onboarding-group"'), html.indexOf('id="open-project-panel"'))
  assert.match(group, /id="continue-project"[^>]*hidden/)
  assert.ok(group.indexOf('id="continue-project"') < group.indexOf('class="onboarding-picker'), 'Continue sits above Open/Create')
  assert.match(group, /id="continue-project-name"/)
  assert.match(app, /async function openRecentProject\(projectPath\)/)
  assert.match(app, /continueProjectButton\.addEventListener\('click'/)
  assert.match(app, /await openRecentProject\(state\.recentProjects\[0\]\)/)
  const render = app.slice(app.indexOf('function renderRecentProjects'))
  assert.match(render.slice(0, render.indexOf('\n}\n')), /updateContinueButton\(\)/)
})

test('a failed Continue says so under the button, because the status pill is hidden on the start screen', () => {
  assert.match(html, /id="continue-project-error"[^>]*hidden/)
  assert.match(app, /continueProjectError\.hidden = true/)
  assert.match(app, /continueProjectError\.textContent = `Could not open \$\{[^}]+\}\. Check that its folder still exists/)
  assert.match(app, /projectStrip\.hidden/)
})

import { readdirSync } from 'node:fs'

test('user docs no longer mention checkpoints, the console or Power user mode', () => {
  const files = [
    'README.md',
    'docs/product/researcher-workflow.md',
    ...readdirSync(new URL('../docs/tutorials/', import.meta.url))
      .filter((name) => name.endsWith('.md'))
      .map((name) => `docs/tutorials/${name}`)
  ]
  for (const file of files) {
    // Link targets (file names such as 01-first-checkpoint.md) are URLs, not text, and stay stable.
    const text = read(file).replace(/\]\([^)]*\)/g, '](...)')
    assert.doesNotMatch(text, /checkpoint|Power user mode|power-user mode|command console/i, file)
  }
})

const fnBody = (name) => {
  const rest = app.slice(app.indexOf(name))
  return rest.slice(0, rest.indexOf('\n}\n'))
}

test('the header is full on the start screen (also via Switch Project) and slim only with a project in view', () => {
  const body = fnBody('function setOnboardingExpanded')
  assert.match(body, /appHeader\.classList\.toggle\('hero-slim', !expanded\)/)
  assert.doesNotMatch(fnBody('function setProjectDependentSectionsVisible'), /hero-slim/)
})

test('Continue is hidden while a project is open, and its error goes with it', () => {
  const body = fnBody('function updateContinueButton')
  assert.match(body, /state\.recentProjects\.length === 0/)
  assert.match(body, /!elements\.projectStrip\.hidden/)
  assert.match(body, /continueProjectError\.hidden = true/)
  assert.match(fnBody('function setProjectDependentSectionsVisible'), /updateContinueButton\(\)/)
  assert.match(fnBody('function renderRecentProjects'), /updateContinueButton\(\)/)
  assert.match(app, /and that you accepted the trust prompt/)
})

test('a finished save clears the message, so the next save gets its own suggestion', () => {
  assert.match(app, /const saveResult = await runWorkflowCommand\('save'/)
  assert.match(app, /if \(saveResult\?\.ok\) \{\s*elements\.message\.value = ''/)
})

test('the unused quick-save message builder is gone', () => {
  assert.doesNotMatch(app, /buildQuickSaveMessage/)
})

test('the suggestion button says what it would insert', () => {
  assert.match(app, /useSuggestionButton\.setAttribute\('aria-label', `Use suggestion: \$\{suggestion\}`\)/)
})

test('REVIEW-OVERVIEW.md no longer describes the removed console', () => {
  assert.doesNotMatch(read('REVIEW-OVERVIEW.md'), /console:runCommand|console:setEnabled|consoleEnabled|console-gate|DISABLE_CONSOLE|Command console|Console toggle/)
})

test('the shared process runner in main.js is called toolRunner (the console it was named after is gone)', () => {
  assert.doesNotMatch(main, /consoleRunner/)
  assert.match(main, /const toolRunner = new ProcessRunner\(\)/)
})

test('the message suggestion describes everything a PRISM or BIDS save will save, and is not offered during a merge', () => {
  const body = fnBody('function updateSaveButtonState')
  assert.match(body, /const prismMode = /)
  assert.match(body, /const savesEverything = prismMode === 'gated' \|\| prismMode === 'bids'/)
  assert.match(body, /savesEverything \? \(snapshot\?\.files \?\? \[\]\)/)
  assert.match(body, /useSuggestionButton\.hidden = !suggestion \|\| Boolean\(snapshot\?\.mergeInProgress\)/)
})

test('a save that reports success but leaves selected files unsaved says so', () => {
  const saveHandler = app.slice(app.indexOf("const saveResult = await runWorkflowCommand('save'"), app.indexOf("elements.verifyDataButton.addEventListener('click'"))
  assert.match(app, /import \{ computeSaveGating, unsavedLeftovers \} from '\.\/save-gating\.js'|unsavedLeftovers/)
  assert.match(saveHandler, /unsavedLeftovers\(selectedPaths, afterSave\?\.files\)/)
  assert.match(saveHandler, /api\.getWorkingTreeStatus\(projectPath\)/)
  assert.match(saveHandler, /still unsaved/)
  assert.match(saveHandler, /prismSavesEverything/) // a gated save ignores the selection, so it is not checked against it
})
