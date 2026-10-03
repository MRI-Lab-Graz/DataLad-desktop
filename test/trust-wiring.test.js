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
  assert.match(body, /!COMMANDS_CREATING_A_NEW_PROJECT\.has\([^)]*\)\) \{[^}]*\} else \{[^}]*await requireTrustedFolder\(event, payload\.request\?\.targetPath\)/)
})
