import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const html = read('../src/gui/renderer/index.html')
const app = read('../src/gui/renderer/app.js')
const preload = read('../src/gui/preload.js')

test('every merge control in the page is looked up by app.js', () => {
  for (const id of ['merge-branch-select', 'merge-branch', 'merge-banner', 'merge-banner-title', 'merge-summary', 'merge-conflict-list', 'merge-cancel', 'merge-finish']) {
    assert.match(html, new RegExp(`id="${id}"`), `index.html lacks #${id}`)
    assert.match(app, new RegExp(`getElementById\\('${id}'\\)`), `app.js never looks up #${id}`)
  }
})

test('the page labels the controls the way the tutorials name them', () => {
  assert.match(html, /Merge Into Current Branch/)
  assert.match(html, />\s*Cancel Merge\s*</)
  assert.match(html, />\s*Finish Merge\s*</)
})

test('the renderer runs the three merge commands and the per-file resolution', () => {
  for (const command of ['merge', 'finishMerge', 'abortMerge']) {
    assert.match(app, new RegExp(`runWorkflowCommand\\('${command}'`), `${command} is never started`)
    assert.match(app, new RegExp(`commandName === '${command}'`), `${command} has no action label`)
  }
  assert.match(app, /api\.resolveConflict\(/)
  assert.match(preload, /resolveConflict:/)
})

test('an open merge blocks branch actions and Save', () => {
  const guard = app.slice(app.indexOf('async function ensureBranchActionSafety'))
  assert.match(guard.slice(0, 600), /snapshot\.mergeInProgress/)
  assert.match(app, /mergeInProgress: Boolean\(snapshot\?\.mergeInProgress\)/)
  assert.match(app, /saveProjectButton\.hidden = Boolean\(snapshot\?\.mergeInProgress\)/)
})

test('conflict buttons use data attributes and one delegated listener (no inline handlers: CSP)', () => {
  assert.match(app, /data-side=/)
  assert.match(app, /mergeConflictList\.addEventListener\('click'/)
  assert.doesNotMatch(app, /onclick=/)
})

test('the Merge handler reports a stop honestly, refuses on an unreadable status, and Update respects an open merge', () => {
  const handler = app.slice(app.indexOf("elements.mergeBranchButton.addEventListener('click'"), app.indexOf("elements.mergeConflictList.addEventListener"))
  assert.match(handler, /Merge stopped: decide each file in the Merge banner\./)
  assert.match(handler, /Could not read the project status\. Try again\./)
  assert.match(handler, /if \(!snapshot\)/)
  const update = app.slice(app.indexOf("elements.updateProjectButton.addEventListener('click'"), app.indexOf("elements.publishProjectButton"))
  assert.match(update, /workingTreeSnapshot\?\.mergeInProgress/)
  assert.match(update, /Finish or cancel the current merge first\./)
  assert.match(app, /friendlyIpcError\(error\)/)
  const branches = app.slice(app.indexOf('async function refreshBranchList'))
  assert.match(branches.slice(0, branches.indexOf('} catch (error)')), /switchBranchButton\.disabled = false\n\s*renderMergeBanner\(\)/)
})
