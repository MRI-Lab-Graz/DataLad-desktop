// main.js imports Electron, so its wiring is pinned by reading it: every path by which a
// folder becomes authorized (typed path, folder picker, create/clone target) must pass
// the folder-trust check first, or a planted .git/hooks would run unprompted.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const main = readFileSync(new URL('../src/gui/main.js', import.meta.url), 'utf8')
const block = (start) => {
  const at = main.indexOf(start)
  assert.ok(at !== -1, `missing ${start}`)
  return main.slice(at, main.indexOf('\n})\n', at))
}

test('the scanner result is awaited (it is async)', () => {
  assert.match(main, /await findExecVectors\(/)
})

test('detectProject checks trust before running git in the folder', () => {
  const body = block("handle('adapter:detectProject'")
  assert.ok(body.indexOf('requireTrustedFolder') !== -1 && body.indexOf('requireTrustedFolder') < body.indexOf('adapter.detectProject'))
})

test('the folder picker only authorizes a folder the user has trusted', () => {
  const body = block("handle('dialog:pickDirectory'")
  assert.ok(body.indexOf('requireTrustedFolder') !== -1 && body.indexOf('requireTrustedFolder') < body.indexOf('authorizeRoot'))
})

test('create/clone check trust of an existing target before running anything', () => {
  const body = block("handle('adapter:runCommand'")
  const trust = body.search(/await requireTrustedFolder\(event, target\)/)
  assert.ok(trust !== -1, 'create/clone no longer checks trust of the target')
  assert.ok(trust < body.indexOf('adapter.runCommand('), 'trust must be checked before the command runs')
  assert.match(body.slice(0, trust), /COMMANDS_CREATING_A_NEW_PROJECT\.has\(/)
})

test('every open re-scans; trust is checked against the current findings', () => {
  assert.match(main, /findExecVectors\(projectPath\)[\s\S]*?folderTrust\(\)\.accepts\(projectPath, vectors\)/)
  assert.doesNotMatch(main, /folderTrust\(\)\.has\(/)
})

test("the app's own clone/create is not trusted blindly: a clone with findings is asked about on first open", () => {
  const body = block("handle('adapter:runCommand'")
  assert.doesNotMatch(body, /folderTrust\(\)\.add\(/)
})

test('turning the console on goes through the native consent, not just the renderer toggle', () => {
  const body = block("handle('console:setEnabled'")
  assert.match(body, /consoleConsent\(\)\.allow\(/)
  assert.match(main, /dialog\.showMessageBox/)
})

test('create/clone into a folder outside every opened folder asks in a native dialog first', () => {
  const body = block("handle('adapter:runCommand'")
  assert.match(body, /isWithinAuthorizedRoot\(dirname\(resolve\([^)]*\)\)\)/)
  assert.match(body, /confirmNewProjectLocation/)
})

test('the e2e auto-confirm seam is never active in a packaged app', () => {
  assert.match(main, /!app\.isPackaged && process\.env\.DATALAD_DESKTOP_E2E_CONFIRM === '1'/)
})
