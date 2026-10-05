import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Text-level rules for the per-user Windows install script (scripts/windows/). Files are read inside each test
// because install.ps1 appears in a later task; the behaviour itself is proven by the CI install job.
const read = (name) => readFile(new URL(`../scripts/windows/${name}`, import.meta.url), 'utf8')
const lines = (text) => text.split(/\r?\n/)

test('install.cmd runs install.ps1 with the execution policy bypassed and passes arguments on', async () => {
  const cmd = await read('install.cmd')
  assert.match(cmd, /powershell -NoProfile -ExecutionPolicy Bypass -File "\.\\install\.ps1" %\*/)
})

test('install.cmd unblocks the downloaded files before running them', async () => {
  const cmd = await read('install.cmd')
  assert.ok(cmd.indexOf('Unblock-File') !== -1, 'no Unblock-File')
  assert.ok(cmd.indexOf('Unblock-File') < cmd.indexOf('-File ".\\install.ps1"'), 'unblock must come first')
})

test('install.cmd has no parenthesised blocks and no goto, so it survives Unix line endings', async () => {
  const cmd = await read('install.cmd')
  for (const line of lines(cmd)) {
    assert.doesNotMatch(line, /\(\s*$/, `opens a block: ${line}`)
    assert.doesNotMatch(line, /^\s*\)/, `closes a block: ${line}`)
    assert.doesNotMatch(line, /^\s*goto\b/i, `goto: ${line}`)
  }
})

test('install.cmd keeps a double-click window open and fails with a non-zero exit when setup fails', async () => {
  const cmd = await read('install.cmd')
  assert.match(cmd, /if errorlevel 1 pause/)
  assert.match(cmd, /if errorlevel 1 exit \/b 1/)
})
