import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// LF endings, so slicing on "\n}\n" also works on a Windows (CRLF) checkout.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const main = read('src/gui/main.js')
const preload = read('src/gui/preload.js')

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
