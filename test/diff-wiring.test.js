import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// LF endings, so slicing on "\n}\n" also works on a Windows (CRLF) checkout.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const main = read('src/gui/main.js')
const preload = read('src/gui/preload.js')

test('the diff handlers check the authorized root, then call the adapter', () => {
  for (const [channel, call] of [['adapter:getFileDiff', 'adapter.getFileDiff(payload.projectPath, payload.request)'], ['adapter:listChangesSince', 'adapter.listChangesSince(payload.projectPath, payload.commitHash)']]) {
    const start = main.indexOf(`handle('${channel}'`)
    assert.notEqual(start, -1, channel)
    const body = main.slice(start, main.indexOf('\n})\n', start))
    assert.match(body, /requireAuthorizedRoot\(payload\.projectPath\)/)
    assert.ok(body.includes(call), call)
  }
})

test('preload exposes both diff calls with exactly those channels', () => {
  assert.match(preload, /getFileDiff: \(projectPath, request\) => ipcRenderer\.invoke\('adapter:getFileDiff', \{ projectPath, request \}\)/)
  assert.match(preload, /listChangesSince: \(projectPath, commitHash\) => ipcRenderer\.invoke\('adapter:listChangesSince', \{ projectPath, commitHash \}\)/)
})

const app = read('src/gui/renderer/app.js')
const css = read('src/gui/renderer/styles.css')
const fnBody = (name) => {
  const rest = app.slice(app.indexOf(name))
  return rest.slice(0, rest.indexOf('\n}\n'))
}

test('Home rows get a Show changes toggle for top-level, non-conflicted files only', () => {
  const body = fnBody('function renderChangedFileItem')
  assert.match(body, /show-diff-button/)
  assert.match(body, /data-diff-path="\$\{escapeHtml\(entry\.path\)\}"/)
  assert.match(body, /data-diff-container="\$\{escapeHtml\(entry\.path\)\}"/)
  assert.match(body, /!isNested && !entry\.isSubmodule && !entry\.conflicted/)
  assert.match(body, /aria-expanded="\$\{open\}"/)
})

test('one loader fills a diff container through the preload API and the shared renderer', () => {
  const body = fnBody('async function loadDiffInto')
  assert.match(body, /api\.getFileDiff\(projectPath, \{ path, against, maxLines \}\)/)
  assert.match(body, /renderDiffHtml\(diff, \{ path, requestedMax: maxLines \}\)/)
  assert.match(body, /catch \(error\)/)
  assert.match(body, /friendlyIpcError\(error\)/)
  assert.match(app, /import \{ DIFF_DEFAULT_LINES, DIFF_MAX_LINES, renderDiffHtml \} from '\.\/diff-view\.js'/)
})

test('Show changes and Show the rest are handled on the Home list', () => {
  assert.match(app, /event\.target\.closest\('\.show-diff-button'\)/)
  assert.match(app, /event\.target\.closest\('\.diff-more-button'\)/)
  assert.match(app, /against: 'HEAD'/)
  assert.match(app, /maxLines: DIFF_MAX_LINES/)
})

test('open diffs survive the list being re-rendered and are refreshed afterwards', () => {
  assert.match(app, /openDiffs: new Map\(\)/)
  assert.match(fnBody('function renderChangedFilesSelection'), /refreshOpenDiffs\(\)/)
  assert.match(fnBody('function renderChangedFilesSelection'), /state\.openDiffs\.clear\(\)/)
  const refresh = fnBody('function refreshOpenDiffs')
  assert.match(refresh, /state\.openDiffs\.delete\(path\)/) // a file that is no longer changed closes its diff
  assert.match(refresh, /loadDiffInto\(/)
})

test('the diff styles exist for every row type and the changed cells', () => {
  for (const selector of ['.file-diff', '.diff-line', '.diff-add', '.diff-del', '.diff-hunk', '.diff-cell-changed']) {
    assert.ok(css.includes(selector), selector)
  }
})

test('a list holding an open diff gets more room than the 220px default', () => {
  assert.match(css, /\.changed-files-list:has\(\.file-diff:not\(\[hidden\]\)\)\s*\{[^}]*max-height:\s*70vh/)
})

const html = read('src/gui/renderer/index.html')

test('the save detail has a Compare with now button and a result area, hidden until used', () => {
  const detail = html.slice(html.indexOf('id="tm-detail"'), html.indexOf('id="tm-branch-from-here"'))
  assert.match(detail, /id="tm-compare"[^>]*>Compare with now</)
  assert.match(detail, /id="tm-compare-output"[^>]*hidden/)
})

test('Compare with now lists the files since the selected save and opens each with the shared loader', () => {
  assert.match(app, /timeMachineCompareButton\.addEventListener\('click'/)
  const body = fnBody("elements.timeMachineCompareButton.addEventListener('click'")
  assert.match(body, /api\.listChangesSince\(projectPath, commitHash\)/)
  assert.match(body, /No differences since this save\./)
  assert.match(app, /timeMachineCompareOutput\.addEventListener\('click'/)
  assert.match(fnBody("elements.timeMachineCompareOutput.addEventListener('click'"), /against: commitHash/)
})

test('the compare list is cleared whenever the selection changes or the detail closes', () => {
  assert.match(fnBody('function clearCompare'), /timeMachineCompareOutput\.hidden = true/)
  assert.match(fnBody('function clearTimeMachine'), /clearCompare\(\)/)
  assert.match(fnBody('async function loadTimeMachineDetail'), /clearCompare\(\)/)
  assert.match(fnBody("elements.timeMachineCloseDetailButton.addEventListener('click'"), /clearCompare\(\)/)
})

test('no dead bookkeeping on the diff containers', () => {
  assert.doesNotMatch(app, /diffAgainst/)
})

test('open diffs belong to one project and are never revived or mixed up by a slow response', () => {
  assert.match(app, /diffRefreshGeneration: 0/)
  assert.match(app, /openDiffsProject: null/)
  const refresh = fnBody('async function refreshOpenDiffs')
  assert.match(refresh, /resetDiffsOnProjectChange\(projectPath\)/)
  // ... and before the list is rebuilt, so another project's cached diff is never drawn as open
  assert.match(fnBody('function renderChangedFilesSelection'), /resetDiffsOnProjectChange\(readProjectPath\(\)\)/)
  const reset = fnBody('function resetDiffsOnProjectChange')
  assert.match(reset, /state\.openDiffsProject === projectPath/)
  assert.match(reset, /state\.openDiffs\.clear\(\)/)
  assert.match(refresh, /const generation = \+\+state\.diffRefreshGeneration/)
  assert.match(refresh, /generation !== state\.diffRefreshGeneration \|\| readProjectPath\(\) !== projectPath/)
  assert.match(refresh, /if \(state\.openDiffs\.has\(path\)\) \{\s*state\.openDiffs\.set\(path, html\)/)
  // the Show/Show-the-rest click records the project and only stores the result if the diff is still open
  assert.match(app, /state\.openDiffsProject = projectPath/)
  assert.match(app, /if \(state\.openDiffs\.has\(path\) && readProjectPath\(\) === projectPath\) \{\s*state\.openDiffs\.set\(path, html\)/)
})

test('every Show changes and Show the rest button names its file for screen readers', () => {
  assert.match(fnBody('function renderChangedFileItem'), /class="button button-ghost button-inline show-diff-button"[^`]*aria-label="Changes in \$\{escapeHtml\(entry\.path\)\}"/)
  assert.match(app, /show-diff-button" data-diff-path="\$\{escapeHtml\(change\.path\)\}" aria-label="Changes in \$\{escapeHtml\(change\.path\)\}"/)
  assert.match(read('src/gui/renderer/diff-view.js'), /diff-more-button" aria-label="Show the rest of the changes"/)
})

test('open diffs reload quietly: old content stays, the chosen length is kept, and a selection change does not reload', () => {
  assert.match(app, /openDiffLines: new Map\(\)/)
  assert.match(app, /diffsLoadedForSnapshot: null/)
  const loader = fnBody('async function loadDiffInto')
  assert.match(loader, /quiet = false/)
  assert.match(loader, /if \(!quiet\) \{\s*container\.innerHTML = loadingPanelHtml/)
  const refresh = fnBody('async function refreshOpenDiffs')
  assert.match(refresh, /state\.diffsLoadedForSnapshot === state\.workingTreeSnapshot/)
  assert.match(refresh, /quiet: true/)
  assert.match(refresh, /maxLines: state\.openDiffLines\.get\(path\) \?\? DIFF_DEFAULT_LINES/)
  assert.match(app, /state\.openDiffLines\.set\(path, DIFF_MAX_LINES\)/)
  assert.match(app, /state\.openDiffLines\.delete\(path\)/)
})

test('remembered diff lengths are forgotten together with the open diffs', () => {
  assert.match(fnBody('function resetDiffsOnProjectChange'), /state\.openDiffLines\.clear\(\)/)
  assert.match(fnBody('function renderChangedFilesSelection'), /state\.openDiffs\.clear\(\)\s*state\.openDiffLines\.clear\(\)/)
})
