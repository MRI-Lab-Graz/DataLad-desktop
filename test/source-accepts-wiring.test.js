import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const main = read('../src/gui/main.js')
const preload = read('../src/gui/preload.js')
const block = (start) => {
  const at = main.indexOf(start)
  assert.ok(at !== -1, `missing ${start}`)
  return main.slice(at, main.indexOf('\n})\n', at))
}

test('setSourceAccepts checks the project first, then validates the answer in main', () => {
  const body = block("handle('adapter:setSourceAccepts'")
  const guard = body.indexOf('requireAuthorizedRoot(payload.projectPath)')
  const check = body.search(/value !== 'yes' && payload\.value !== 'no'|\['yes', 'no'\]\.includes\(payload\.value\)/)
  assert.ok(guard !== -1 && check > guard && check < body.indexOf('adapter.setSourceAccepts('))
})

test('clearSourceAccepts checks the project first and takes no free-text value', () => {
  const body = block("handle('adapter:clearSourceAccepts'")
  assert.ok(body.indexOf('requireAuthorizedRoot(projectPath)') !== -1)
  assert.ok(body.indexOf('requireAuthorizedRoot(') < body.indexOf('adapter.clearSourceAccepts('))
})

test('the page can only ask for yes, no or clearing, through the preload', () => {
  assert.match(preload, /setSourceAccepts: \(projectPath, value\) => ipcRenderer\.invoke\('adapter:setSourceAccepts', \{ projectPath, value \}\)/)
  assert.match(preload, /clearSourceAccepts: \(projectPath\) => ipcRenderer\.invoke\('adapter:clearSourceAccepts', projectPath\)/)
})
