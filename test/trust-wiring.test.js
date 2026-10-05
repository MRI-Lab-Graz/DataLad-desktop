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
  const project = body.search(/PUSHES\.has\(payload\.commandName\)[\s\S]{0,200}await trustGate\(\)\.require\(payload\.request\.projectPath, \{ event \}\)/)
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

// Review 5.
test('nesting a folder (createSubdataset) re-runs the gate on the project first, like push does', () => {
  const body = block("handle('adapter:runCommand'")
  const gate = body.search(/commandName === 'createSubdataset'[\s\S]{0,300}await trustGate\(\)\.require\(payload\.request\.projectPath, \{ event \}\)/)
  assert.ok(gate !== -1, 'createSubdataset no longer re-checks the project')
  assert.ok(gate < body.indexOf('adapter.runCommand('))
})

test('picking a clone SOURCE folder returns the path without asking to trust it and without authorizing it', () => {
  const body = block("handle('dialog:pickDirectory'")
  const purpose = body.search(/options\.purpose === 'source'/)
  assert.ok(purpose !== -1 && purpose < body.indexOf('trustGate().require(picked'))
  assert.ok(purpose < body.indexOf('pickedLocations.add('))
  const app = readFileSync(new URL('../src/gui/renderer/app.js', import.meta.url), 'utf8')
  assert.match(app, /wireFolderPicker\(elements\.pickGetRemoteNetworkPathButton[\s\S]{0,200}purpose: 'source'/)
  assert.match(app, /purpose: options\.purpose/)
})

test('createProject into an empty target ignores force, so a folder filled in between cannot be adopted unasked', () => {
  const body = block("handle('adapter:runCommand'")
  assert.match(body, /if \(createdEmpty\) \{\s*request = \{ \.\.\.request, force: false \}/)
})

// A new handler must be classified: guarded by the authorized-root check, behind the trust gate, taking no
// folder, or a documented read-only exception. Otherwise this test fails until someone decides.
test('every IPC handler is classified', () => {
  const handlers = [...main.matchAll(/handle\('([^']+)'/g)].map((m) => m[1])
  const guarded = ['adapter:ensureBidsMarker', 'adapter:findUnnestedBidsCandidates', 'adapter:untrackPath', 'prism:inspect', 'adapter:listDatasets', 'adapter:ignoreOsNoiseFiles', 'adapter:readGitignore', 'adapter:addIgnorePatterns', 'adapter:listBranches', 'adapter:getLastCommit', 'adapter:getWorkingTreeStatus', 'adapter:listRecentCommits', 'adapter:getCommitDetails', 'adapter:getProjectHealth', 'adapter:clearRepositoryLock', 'watch:setActiveProject', 'console:runCommand', 'fs:listEntries', 'fs:revealPath']
  const gated = ['adapter:detectProject', 'dialog:pickDirectory', 'adapter:runCommand']
  const noFolder = ['adapter:checkEnvironment', 'adapter:cancelCommand', 'env:status', 'env:ensure', 'console:setEnabled', 'identity:get', 'identity:set', 'app:getWorkspaceRoot']
  const readOnlyException = ['adapter:inspectBidsCandidate'] // lists marker names in a typed folder before it is authorized; runs no git
  assert.deepEqual([...handlers].sort(), [...guarded, ...gated, ...noFolder, ...readOnlyException].sort(), 'classify new handlers here')
  for (const name of guarded) {
    assert.match(block(`handle('${name}'`), /requireAuthorizedRoot\(|isWithinAuthorizedRoot\(/, `${name} does not check the authorized roots`)
  }
  for (const name of ['adapter:detectProject', 'dialog:pickDirectory', 'adapter:runCommand']) {
    assert.match(block(`handle('${name}'`), /trustGate\(\)/, `${name} does not use the gate`)
  }
})

// The re-check scans the project (seconds on a big one). It must happen INSIDE the registered run: a Stop pressed
// meanwhile would otherwise find nothing to cancel, and the command would then start anyway.
test('the push/nesting re-check runs inside the registered run, so a Stop pressed during it is honoured', () => {
  const body = block("handle('adapter:runCommand'")
  assert.match(body, /runWithHandle\(event, payload\.runId, async \(runOptions\) => \{\s*await recheckTrust\(\)\s*return adapter\.runCommand\(/)
  assert.match(body, /recheckTrust = async \(\) => \{\s*if \(PUSHES\.has\(payload\.commandName\) \|\| payload\.commandName === 'createSubdataset'\) \{\s*await trustGate\(\)\.require\(payload\.request\.projectPath, \{ event \}\)[\s\S]*?localRemotePaths\(/)
})

test('sending versions to a remote re-checks trust exactly like Publish', () => {
  const body = block("handle('adapter:runCommand'")
  assert.match(main, /const PUSHES = new Set\(\['push', 'pushTags'\]\)/)
  const recheck = body.slice(body.indexOf('recheckTrust = async'), body.indexOf('} else {'))
  assert.match(recheck, /PUSHES\.has\(payload\.commandName\)/)
  assert.doesNotMatch(recheck, /payload\.commandName === 'push'/)
})

test('Get and Publish report file-count progress to the page', () => {
  assert.match(main, /'command:progress'/)
  const body = block("handle('adapter:runCommand'")
  assert.match(body, /progress: payload\.commandName === 'get' \|\| payload\.commandName === 'push'/)
})
