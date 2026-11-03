import test from 'node:test'
import assert from 'node:assert/strict'
import { linesOf, defaultRunMessage, computeRunGating } from '../src/gui/renderer/run-dialog.js'

test('linesOf keeps one trimmed entry per non-empty line, whatever the line endings', () => {
  assert.deepEqual(linesOf(' data/a.csv \r\n\r\nraw/*.tsv\n   \nmy file.csv'), ['data/a.csv', 'raw/*.tsv', 'my file.csv'])
  assert.deepEqual(linesOf(''), [])
  assert.deepEqual(linesOf(undefined), [])
})

test('defaultRunMessage names the command, from its first line, shortened', () => {
  assert.equal(defaultRunMessage('python summarize.py'), 'Run: python summarize.py')
  assert.equal(defaultRunMessage('  python a.py\nsecond line'), 'Run: python a.py')
  assert.equal(defaultRunMessage(''), '')
  const long = defaultRunMessage('x'.repeat(200))
  assert.equal(long.length, 'Run: '.length + 60 + 1)
  assert.ok(long.endsWith('…'))
})

test('computeRunGating needs a command and a message, and a project without unsaved changes', () => {
  assert.deepEqual(computeRunGating({ command: 'a', message: 'm', clean: true }), { disabled: false, hint: '' })
  assert.equal(computeRunGating({ command: '  ', message: 'm', clean: true }).disabled, true)
  assert.equal(computeRunGating({ command: 'a', message: ' ', clean: true }).disabled, true)
  const dirty = computeRunGating({ command: 'a', message: 'm', clean: false })
  assert.equal(dirty.disabled, true)
  assert.match(dirty.hint, /Save your changes first/)
  assert.equal(computeRunGating({ command: 'a', message: 'm', clean: undefined }).disabled, false) // status not read yet: DataLad decides
})
