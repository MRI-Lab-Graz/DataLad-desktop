import test from 'node:test'
import assert from 'node:assert/strict'
import { buildConsoleCommand, tokenizeCommand } from '../src/datalad/console-command.js'

test('tokenizeCommand splits on whitespace', () => {
  assert.deepEqual(tokenizeCommand('status --annex all'), ['status', '--annex', 'all'])
})

test('tokenizeCommand collapses repeated whitespace', () => {
  assert.deepEqual(tokenizeCommand('  status   --annex   all  '), ['status', '--annex', 'all'])
})

test('tokenizeCommand returns an empty array for empty input', () => {
  assert.deepEqual(tokenizeCommand(''), [])
  assert.deepEqual(tokenizeCommand('   '), [])
})

test('tokenizeCommand keeps quoted segments as one token', () => {
  assert.deepEqual(tokenizeCommand('save -m "fixed a typo"'), ['save', '-m', 'fixed a typo'])
})

test('tokenizeCommand supports single quotes', () => {
  assert.deepEqual(tokenizeCommand("save -m 'fixed a typo'"), ['save', '-m', 'fixed a typo'])
})

test('tokenizeCommand throws on an unterminated quote', () => {
  assert.throws(() => tokenizeCommand('save -m "unterminated'), /Unterminated quote/)
})

test('tokenizeCommand treats shell metacharacters as literal text', () => {
  assert.deepEqual(tokenizeCommand('status && rm -rf /'), ['status', '&&', 'rm', '-rf', '/'])
})

test('buildConsoleCommand rejects a binary outside the allowlist', () => {
  assert.throws(
    () => buildConsoleCommand({ binary: 'bash', argsText: '-c "echo hi"', projectPath: '/tmp/proj' }),
    /Unsupported console binary/
  )
})

test('buildConsoleCommand rejects a missing projectPath', () => {
  assert.throws(
    () => buildConsoleCommand({ binary: 'datalad', argsText: 'status' }),
    /projectPath is required/
  )
})

test('buildConsoleCommand rejects a blank projectPath', () => {
  assert.throws(
    () => buildConsoleCommand({ binary: 'git', argsText: 'log', projectPath: '   ' }),
    /projectPath is required/
  )
})

test('buildConsoleCommand returns argv and cwd for a valid request', () => {
  const commandSpec = buildConsoleCommand({
    binary: 'git',
    argsText: 'log -1 --oneline',
    projectPath: '/tmp/proj'
  })

  assert.deepEqual(commandSpec, {
    command: 'git',
    args: ['log', '-1', '--oneline'],
    options: { cwd: '/tmp/proj' }
  })
})

test('buildConsoleCommand allows empty arguments', () => {
  const commandSpec = buildConsoleCommand({ binary: 'datalad', argsText: '', projectPath: '/tmp/proj' })
  assert.deepEqual(commandSpec.args, [])
})
