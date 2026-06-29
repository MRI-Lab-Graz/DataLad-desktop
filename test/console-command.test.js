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
  assert.deepEqual(tokenizeCommand('git commit -m "fixed a typo"'), ['git', 'commit', '-m', 'fixed a typo'])
})

test('tokenizeCommand supports single quotes', () => {
  assert.deepEqual(tokenizeCommand("git commit -m 'fixed a typo'"), ['git', 'commit', '-m', 'fixed a typo'])
})

test('tokenizeCommand throws on an unterminated quote', () => {
  assert.throws(() => tokenizeCommand('git commit -m "unterminated'), /Unterminated quote/)
})

test('tokenizeCommand treats shell metacharacters as literal text', () => {
  assert.deepEqual(tokenizeCommand('status && rm -rf /'), ['status', '&&', 'rm', '-rf', '/'])
})

test('buildConsoleCommand rejects a missing projectPath', () => {
  assert.throws(
    () => buildConsoleCommand({ commandText: 'git status' }),
    /projectPath is required/
  )
})

test('buildConsoleCommand rejects a blank projectPath', () => {
  assert.throws(
    () => buildConsoleCommand({ commandText: 'git log', projectPath: '   ' }),
    /projectPath is required/
  )
})

test('buildConsoleCommand rejects empty command text', () => {
  assert.throws(
    () => buildConsoleCommand({ commandText: '   ', projectPath: '/tmp/proj' }),
    /Enter a command to run/
  )
})

test('buildConsoleCommand splits the first token off as the binary, any binary allowed', () => {
  const commandSpec = buildConsoleCommand({ commandText: 'python script.py --flag', projectPath: '/tmp/proj' })

  assert.deepEqual(commandSpec, {
    command: 'python',
    args: ['script.py', '--flag'],
    options: { cwd: '/tmp/proj' }
  })
})

test('buildConsoleCommand returns argv and cwd for a valid request', () => {
  const commandSpec = buildConsoleCommand({
    commandText: 'git log -1 --oneline',
    projectPath: '/tmp/proj'
  })

  assert.deepEqual(commandSpec, {
    command: 'git',
    args: ['log', '-1', '--oneline'],
    options: { cwd: '/tmp/proj' }
  })
})

test('buildConsoleCommand allows a binary with no arguments', () => {
  const commandSpec = buildConsoleCommand({ commandText: 'datalad', projectPath: '/tmp/proj' })
  assert.deepEqual(commandSpec.args, [])
})
