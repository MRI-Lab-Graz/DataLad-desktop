// main.js imports Electron, so its wiring is pinned by reading it. The rule (spec: trust before run): a folder
// becomes a project root only through the trust gate, i.e. after the user said yes, an administrator listed its
// location, or the app created it empty. Every handler that touches a folder already requires an authorized root.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const main = readFileSync(new URL('../src/gui/main.js', import.meta.url), 'utf8')
const block = (start) => {
  const at = main.indexOf(start)
  assert.ok(at !== -1, `missing ${start}`)
  return main.slice(at, main.indexOf('\n})\n', at))
}

test('turning the console on goes through the native consent, not just the renderer toggle', () => {
  const body = block("handle('console:setEnabled'")
  assert.match(body, /consoleConsent\(\)\.allow\(/)
  assert.match(main, /dialog\.showMessageBox/)
})

test('the e2e auto-confirm seam is never active in a packaged app', () => {
  assert.match(main, /!app\.isPackaged && process\.env\.DATALAD_DESKTOP_E2E_CONFIRM === '1'/)
})

test('authorizeRoot is passed to the trust gate and called nowhere else', () => {
  assert.equal((main.match(/authorizeRoot\(/g) ?? []).length, 1, 'only the definition may mention authorizeRoot(')
  assert.match(main, /authorize: authorizeRoot/)
})

test('the old check and the old trust store are gone', () => {
  assert.doesNotMatch(main, /requireTrustedFolder/)
  assert.doesNotMatch(main, /folderTrust\(\)/)
})

test('detectProject goes through the gate before git runs in the folder', () => {
  const body = block("handle('adapter:detectProject'")
  const gate = body.search(/await trustGate\(\)\.require\(projectPath, \{ event \}\)/)
  assert.ok(gate !== -1 && gate < body.indexOf('adapter.detectProject'))
})

test('the folder picker authorizes only through the gate, and an empty folder is only a place for a new project', () => {
  const body = block("handle('dialog:pickDirectory'")
  assert.match(body, /isEmptyOrMissing\(picked\)/)
  assert.match(body, /pickedLocations\.add\(/)
  assert.match(body, /await trustGate\(\)\.require\(picked, \{ event: _event \}\)/)
  assert.ok(body.indexOf('isEmptyOrMissing(picked)') < body.indexOf('trustGate().require(picked'))
})

test('createProject trusts only an empty or missing target; adopting an existing folder asks first', () => {
  const body = block("handle('adapter:runCommand'")
  assert.match(body, /payload\.commandName === 'createProject'[\s\S]*?createdEmpty = await isEmptyOrMissing\(target\)/)
  assert.match(body, /if \(!createdEmpty\) \{\s*await trustGate\(\)\.require\(target, \{ event \}\)/)
  assert.match(body, /result\?\.ok && createdEmpty[\s\S]*?trustGate\(\)\.createdByApp\(/)
})

test('a clone is never trusted or authorized by the app: its first open asks', () => {
  const body = block("handle('adapter:runCommand'")
  assert.equal((body.match(/createdByApp\(/g) ?? []).length, 1)
  assert.doesNotMatch(body, /cloneInstall[\s\S]{0,200}createdByApp/)
})

test('a push re-checks the project and every local-path remote right before the command', () => {
  const body = block("handle('adapter:runCommand'")
  const project = body.search(/commandName === 'push'[\s\S]{0,200}await trustGate\(\)\.require\(payload\.request\.projectPath, \{ event \}\)/)
  const remotes = body.search(/localRemotePaths\(consoleRunner, payload\.request\.projectPath\)[\s\S]{0,200}kind: 'remote'/)
  assert.ok(project !== -1 && remotes !== -1)
  assert.ok(remotes < body.indexOf('adapter.runCommand('))
})

test('a create/clone target outside every opened folder still asks where, unless the user picked it in the native dialog', () => {
  const body = block("handle('adapter:runCommand'")
  assert.match(body, /!isWithinAuthorizedRoot\(target\) && !isWithinRoots\(target, pickedLocations\)/)
  assert.doesNotMatch(body, /isWithinAuthorizedRoot\(dirname\(/)
  const refuse = body.search(/typeof target !== 'string'/)
  assert.ok(refuse !== -1 && refuse < body.indexOf('confirmNewProjectLocation'))
})
