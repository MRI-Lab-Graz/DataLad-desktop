import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// LF endings, so slicing on "\n}\n" also works on a Windows (CRLF) checkout.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const main = read('src/gui/main.js')
const preload = read('src/gui/preload.js')
const app = read('src/gui/renderer/app.js')
const html = read('src/gui/renderer/index.html')
const fnBody = (name) => {
  const rest = app.slice(app.indexOf(name))
  return rest.slice(0, rest.indexOf('\n}\n'))
}

test('a run is refused when disabled, and confirmed natively before anything starts', () => {
  const start = main.indexOf("handle('adapter:runCommand'")
  const body = main.slice(start, main.indexOf('\n})\n', start))
  assert.match(body, /payload\.commandName === 'run'/)
  const run = body.slice(body.indexOf("payload.commandName === 'run'"))
  assert.match(run, /policy\.runDisabled/)
  assert.match(run, /confirmNative\(event, \{[\s\S]*?payload\.request\.command/)
  assert.match(run, /runDeclinedResult\(\)/)
  assert.ok(body.indexOf("payload.commandName === 'run'") < body.indexOf('runWithHandle'), 'confirmed before a run handle exists')
})

test('capabilities tell the page whether Run & record is available', () => {
  assert.match(main, /handle\('app:capabilities', \(\) => \(\{ run: !policy\.runDisabled \}\)\)/)
  assert.match(preload, /getCapabilities: \(\) => ipcRenderer\.invoke\('app:capabilities'\)/)
})

test('the History panel has a Run & record button and a modal form', () => {
  const history = html.slice(html.indexOf('id="time-machine-zone"'))
  assert.match(history, /id="open-run"[^>]*>Run &amp; record…</)
  const form = html.slice(html.indexOf('id="run-overlay"'))
  assert.match(form, /id="run-form"[^>]*role="dialog"[^>]*aria-modal="true"/)
  for (const id of ['run-command', 'run-inputs', 'run-outputs', 'run-message', 'run-hint', 'run-submit', 'run-cancel']) {
    assert.match(form, new RegExp(`id="${id}"`), id)
  }
  assert.match(html, /id="run-overlay"[^>]*hidden/)
})

test('submitting runs through the shared workflow with the parsed fields, then refreshes History', () => {
  const body = fnBody("elements.runForm.addEventListener('submit'")
  assert.match(body, /runWorkflowCommand\(\s*'run',/)
  assert.match(body, /inputs: linesOf\(elements\.runInputs\.value\)/)
  assert.match(body, /outputs: linesOf\(elements\.runOutputs\.value\)/)
  assert.match(body, /refreshTimeMachineHistory\(projectPath\)/)
  assert.match(body, /closeRunDialog\(\)/)
})

test('the form keeps Run disabled for an empty form or unsaved changes, and Escape closes it', () => {
  assert.match(fnBody('function updateRunGating'), /computeRunGating\(\{[\s\S]*clean: state\.workingTreeSnapshot\?\.clean/)
  assert.match(app, /elements\.runOverlay\.addEventListener\('keydown'[\s\S]{0,120}Escape/)
})

test('the button follows the admin switch and a run is labelled Run', () => {
  assert.match(app, /api\.getCapabilities\(\)\.then\(\(capabilities\) => \{\s*elements\.openRunButton\.hidden = !capabilities\.run/)
  assert.match(fnBody('function actionLabel'), /commandName === 'run'\) \{\s*return 'Run'/)
})

test('an open form follows the live project status, so a change appearing while it is open disables Run', () => {
  assert.match(fnBody('function updateSaveButtonState'), /if \(!elements\.runOverlay\.hidden\) \{\s*updateRunGating\(\)/)
})
