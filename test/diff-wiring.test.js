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
