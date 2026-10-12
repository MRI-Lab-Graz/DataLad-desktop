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
