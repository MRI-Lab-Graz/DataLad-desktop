import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// datalad push without --to has to guess the target and could not on Windows ("No push target given"),
// so the push never succeeded and the versions were never sent. The app knows the remote: it says so.
test('Publish pushes to the project\'s named remote instead of letting datalad guess', () => {
  const app = readFileSync(new URL('../src/gui/renderer/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const handler = app.slice(app.indexOf('elements.publishProjectButton.addEventListener'))
  const push = handler.indexOf("runWorkflowCommand('push'")
  const name = handler.indexOf('remoteNameForProject(')
  assert.ok(name !== -1 && name < push, 'the remote is looked up before the push')
  assert.match(handler.slice(push, push + 120), /\{ projectPath, remoteName \}/)
})
