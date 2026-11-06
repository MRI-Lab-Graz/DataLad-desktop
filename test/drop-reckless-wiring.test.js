import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const main = readFileSync(new URL('../src/gui/main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const block = main.slice(main.indexOf("payload.commandName === 'dropReckless'"))

test('main asks natively before dropReckless runs, and a refusal runs nothing', () => {
  const ask = block.indexOf('confirmNative(')
  const decline = block.indexOf('return runDeclinedResult(')
  const run = main.indexOf('adapter.runCommand(payload.commandName')
  assert.ok(ask > 0 && decline > ask && run > decline)
  assert.match(block, /Delete without a safety check\?/)
  assert.match(block, /confirmLabel: 'Delete'/)
})

test('the declined result carries the command name that was declined', () => {
  assert.match(main, /const runDeclinedResult = \(commandName = 'run'\)/)
})
