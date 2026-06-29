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
    () => buildConsoleCommand({ commandText: 'git status', platform: 'darwin' }),
    /projectPath is required/
  )
})

test('buildConsoleCommand rejects a blank projectPath', () => {
  assert.throws(
    () => buildConsoleCommand({ commandText: 'git log', projectPath: '   ', platform: 'darwin' }),
    /projectPath is required/
  )
})

test('buildConsoleCommand rejects empty command text', () => {
  assert.throws(
    () => buildConsoleCommand({ commandText: '   ', projectPath: '/tmp/proj', platform: 'darwin' }),
    /Enter a command to run/
  )
})

test('on macOS/Linux: splits the first token off as the binary, any binary allowed, no shell', () => {
  const commandSpec = buildConsoleCommand({
    commandText: 'python script.py --flag',
    projectPath: '/tmp/proj',
    platform: 'darwin'
  })

  assert.deepEqual(commandSpec, {
    command: 'python',
    args: ['script.py', '--flag'],
    options: { cwd: '/tmp/proj', shell: false }
  })
})

test('on macOS/Linux: returns argv and cwd for a valid request', () => {
  const commandSpec = buildConsoleCommand({
    commandText: 'git log -1 --oneline',
    projectPath: '/tmp/proj',
    platform: 'linux'
  })

  assert.deepEqual(commandSpec, {
    command: 'git',
    args: ['log', '-1', '--oneline'],
    options: { cwd: '/tmp/proj', shell: false }
  })
})

test('on macOS/Linux: allows a binary with no arguments', () => {
  const commandSpec = buildConsoleCommand({ commandText: 'datalad', projectPath: '/tmp/proj', platform: 'darwin' })
  assert.deepEqual(commandSpec.args, [])
})

test('on Windows: hands the raw command line to the shell instead of tokenizing', () => {
  const commandSpec = buildConsoleCommand({
    commandText: 'npm run build && echo done',
    projectPath: 'C:\\proj',
    platform: 'win32'
  })

  assert.deepEqual(commandSpec, {
    command: 'npm run build && echo done',
    args: [],
    options: { cwd: 'C:\\proj', shell: true }
  })
})

test('on Windows: trims the command line before handing it to the shell', () => {
  const commandSpec = buildConsoleCommand({
    commandText: '   git log -1   ',
    projectPath: 'C:\\proj',
    platform: 'win32'
  })

  assert.equal(commandSpec.command, 'git log -1')
})

test('defaults to the real process.platform when none is passed', () => {
  const commandSpec = buildConsoleCommand({ commandText: 'git status', projectPath: '/tmp/proj' })
  assert.equal(commandSpec.options.shell, process.platform === 'win32')
})
